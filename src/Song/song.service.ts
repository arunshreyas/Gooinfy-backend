import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'node:fs';
import { extname, join, parse } from 'node:path';
import { PrismaService } from 'src/prisma.service';
import { SearchSongsDto } from './dto/search-songs.dto';

@Injectable()
export class SongService {
  private readonly navidromeUrl: string;
  private readonly navidromeUser: string;
  private readonly navidromePass: string;
  private readonly navidromeVersion: string;
  private readonly navidromeClient: string;
  private readonly musicRoot: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.navidromeUrl =
      this.configService.get<string>('NAVIDROME_URL') ?? 'http://localhost:4533';
    this.navidromeUser =
      this.configService.get<string>('NAVIDROME_USER') ?? 'mobbu';
    this.navidromePass =
      this.configService.get<string>('NAVIDROME_PASS') ?? 'm3%26Mango';
    this.navidromeVersion =
      this.configService.get<string>('NAVIDROME_VERSION') ?? '1.16.1';
    this.navidromeClient =
      this.configService.get<string>('NAVIDROME_CLIENT_NAME') ?? 'myapp';
    this.musicRoot = this.configService.get<string>('MUSIC_ROOT') ?? 'music';
  }

  private requireUserId(userId: string | undefined): string {
    if (!userId?.trim()) {
      throw new BadRequestException('userId is required until JWT auth is wired.');
    }

    return userId;
  }

  private async ensureUserExists(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User with id ${userId} not found.`);
    }

    return user;
  }

  private async ensureOwnedSong(songId: string, userId: string) {
    const song = await this.prisma.song.findFirst({
      where: { id: songId, userId },
    });

    if (!song) {
      throw new NotFoundException(`Song with id ${songId} not found for this user.`);
    }

    return song;
  }

  private buildNavidromeParams(extra: Record<string, string | number | undefined>) {
    const params = new URLSearchParams({
      u: this.navidromeUser,
      p: this.navidromePass,
      v: this.navidromeVersion,
      c: this.navidromeClient,
      f: 'json',
    });

    for (const [key, value] of Object.entries(extra)) {
      if (value !== undefined && value !== null && `${value}`.length > 0) {
        params.append(key, `${value}`);
      }
    }

    return params;
  }

  private async navidromeJson(
    endpoint: string,
    extra: Record<string, string | number | undefined>,
  ) {
    const params = this.buildNavidromeParams(extra);
    const baseUrl = this.navidromeUrl.replace(/\/$/, '');
    const response = await fetch(`${baseUrl}/rest/${endpoint}.view?${params.toString()}`);

    if (!response.ok) {
      throw new InternalServerErrorException(
        `Navidrome request failed with status ${response.status}.`,
      );
    }

    const data = (await response.json()) as {
      'subsonic-response'?: {
        status?: string;
        error?: { message?: string };
        searchResult3?: { song?: unknown };
        scanStatus?: unknown;
      };
    };

    const payload = data['subsonic-response'];
    if (!payload || payload.status !== 'ok') {
      throw new InternalServerErrorException(
        payload?.error?.message ?? `Navidrome ${endpoint} request failed.`,
      );
    }

    return payload;
  }

  private normalizeSongs(value: unknown) {
    if (!value) {
      return [] as Array<Record<string, unknown>>;
    }

    return (Array.isArray(value) ? value : [value]) as Array<Record<string, unknown>>;
  }

  private sanitizeFilename(originalName: string) {
    const extension = extname(originalName).toLowerCase();
    const base = parse(originalName).name.replace(/[^a-zA-Z0-9-_]/g, '_');
    return `${Date.now()}-${base}${extension}`;
  }

  private validateAudioFile(file: {
    originalname: string;
    mimetype?: string;
    size?: number;
  }) {
    const extension = extname(file.originalname).toLowerCase();
    const allowedExtensions = new Set(['.mp3', '.flac', '.wav', '.m4a']);

    if (!allowedExtensions.has(extension)) {
      throw new BadRequestException('Only .mp3, .flac, .wav, and .m4a files are supported.');
    }

    if ((file.size ?? 0) <= 0) {
      throw new BadRequestException('Uploaded file is empty.');
    }
  }

  private async waitForIndexedSong(query: string, userId: string) {
    const attempts = 8;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const payload = await this.navidromeJson('search3', {
        query,
        songCount: 10,
        albumCount: 0,
        artistCount: 0,
      });
      const songs = this.normalizeSongs(payload.searchResult3?.song);
      const matched = songs.find((song) => {
        const title = typeof song.title === 'string' ? song.title.toLowerCase() : '';
        const path = typeof song.path === 'string' ? song.path.toLowerCase() : '';
        const probe = query.toLowerCase();
        return title.includes(probe) || path.includes(`${userId.toLowerCase()}/`);
      });

      if (matched) {
        return matched;
      }

      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    throw new InternalServerErrorException(
      'Upload reached Navidrome scan, but the song was not indexed in time.',
    );
  }

  async uploadSong(
    file: { buffer: Buffer; originalname: string; mimetype?: string; size?: number } | undefined,
    userIdInput: string | undefined,
  ) {
    const userId = this.requireUserId(userIdInput);
    await this.ensureUserExists(userId);

    if (!file) {
      throw new BadRequestException('An audio file is required.');
    }

    this.validateAudioFile(file);

    const safeFilename = this.sanitizeFilename(file.originalname);
    const userDirectory = join(this.musicRoot, userId);
    await fs.mkdir(userDirectory, { recursive: true });

    const storedPath = join(userDirectory, safeFilename);
    await fs.writeFile(storedPath, file.buffer);

    await this.navidromeJson('startScan', {});
    const indexedSong = await this.waitForIndexedSong(parse(file.originalname).name, userId);

    const navidromeId = typeof indexedSong.id === 'string' ? indexedSong.id : null;
    const title = typeof indexedSong.title === 'string' ? indexedSong.title : parse(file.originalname).name;
    const artist = typeof indexedSong.artist === 'string' ? indexedSong.artist : null;
    const duration = typeof indexedSong.duration === 'number' ? indexedSong.duration : null;

    if (!navidromeId) {
      throw new InternalServerErrorException('Navidrome indexed the song without returning an id.');
    }

    return this.prisma.song.upsert({
      where: { navidromeId },
      update: {
        title,
        artist,
        duration,
        userId,
      },
      create: {
        navidromeId,
        title,
        artist,
        duration,
        userId,
      },
    });
  }

  async searchSongs(dto: SearchSongsDto) {
    const query = dto.query?.trim();
    if (!query) {
      throw new BadRequestException('query is required.');
    }

    const payload = await this.navidromeJson('search3', {
      query,
      songCount: dto.limit ?? 20,
      albumCount: 0,
      artistCount: 0,
    });

    return this.normalizeSongs(payload.searchResult3?.song);
  }

  async getMySongs(userIdInput: string | undefined) {
    const userId = this.requireUserId(userIdInput);
    await this.ensureUserExists(userId);

    return this.prisma.song.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getStreamUrl(songId: string, userIdInput: string | undefined) {
    const userId = this.requireUserId(userIdInput);
    const song = await this.ensureOwnedSong(songId, userId);
    const params = this.buildNavidromeParams({ id: song.navidromeId });

    return {
      songId: song.id,
      navidromeId: song.navidromeId,
      streamUrl: `${this.navidromeUrl.replace(/\/$/, '')}/rest/stream.view?${params.toString()}`,
    };
  }

  async deleteSong(songId: string, userIdInput: string | undefined) {
    const userId = this.requireUserId(userIdInput);
    const song = await this.ensureOwnedSong(songId, userId);

    await this.prisma.$transaction([
      this.prisma.playlistSong.deleteMany({ where: { songId: song.id } }),
      this.prisma.song.delete({ where: { id: song.id } }),
    ]);

    return {
      message: 'Song removed from Goonify metadata. The media file remains on disk/Navidrome.',
      songId: song.id,
      navidromeId: song.navidromeId,
    };
  }
}
