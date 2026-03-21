import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Song } from '@prisma/client';
import { promises as fs } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { AuthUser } from 'src/common/decorators/current-user.decorator';
import { PrismaService } from 'src/prisma.service';
import { SearchSongsDto } from './dto/search-songs.dto';
import { UploadSongDto } from './dto/upload-song.dto';

type UploadedTrack = {
  title: string;
  artist?: string | null;
  originalFilename: string;
  buffer: Buffer;
  size?: number;
};

@Injectable()
export class SongService {
  private readonly navidromeUrl: string;
  private readonly navidromeUser: string;
  private readonly navidromePass: string;
  private readonly musicRoot: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.navidromeUrl = this.configService.get<string>('NAVIDROME_URL') ?? 'http://localhost:4533';
    this.navidromeUser = this.configService.get<string>('NAVIDROME_USER') ?? 'mobbu';
    this.navidromePass = this.configService.get<string>('NAVIDROME_PASS') ?? 'm3%26Mango';
    this.musicRoot = this.configService.get<string>('MUSIC_ROOT') ?? 'music';
  }

  getUserId(user: AuthUser): string {
    const userId = user.id ?? user.userId ?? user.sub;
    if (!userId) {
      throw new BadRequestException('Authenticated user id is missing from JWT payload.');
    }
    return userId;
  }

  private buildNavidromeParams(extra: Record<string, string | number | undefined>) {
    const params = new URLSearchParams({
      u: this.navidromeUser,
      p: this.navidromePass,
      v: '1.16.1',
      c: 'myapp',
      f: 'json',
    });

    for (const [key, value] of Object.entries(extra)) {
      if (value !== undefined && value !== null) {
        params.append(key, `${value}`);
      }
    }

    return params;
  }

  private async navidromeJson(endpoint: string, extra: Record<string, string | number | undefined>) {
    const baseUrl = this.navidromeUrl.replace(/\/$/, '');
    const params = this.buildNavidromeParams(extra);
    const response = await fetch(`${baseUrl}/rest/${endpoint}.view?${params.toString()}`);
    const data = (await response.json()) as {
      'subsonic-response'?: {
        status?: string;
        error?: { message?: string };
        searchResult3?: { song?: unknown };
      };
    };

    if (!response.ok || data['subsonic-response']?.status !== 'ok') {
      throw new BadRequestException(
        data['subsonic-response']?.error?.message ?? `Navidrome ${endpoint} failed.`,
      );
    }

    return data['subsonic-response'];
  }

  private normalizeSongs(value: unknown) {
    if (!value) {
      return [] as Array<Record<string, unknown>>;
    }

    return (Array.isArray(value) ? value : [value]) as Array<Record<string, unknown>>;
  }

  private async ensureOwnedSong(id: string, userId: string) {
    const song = await this.prisma.song.findFirst({ where: { id, userId } });
    if (!song) {
      throw new NotFoundException(`Song with id ${id} not found.`);
    }
    return song;
  }

  private validateMp3File(file: { originalFilename: string; size?: number }) {
    if (!file.originalFilename.toLowerCase().endsWith('.mp3')) {
      throw new BadRequestException('Only MP3 uploads are supported in this version.');
    }

    if (!file.size || file.size <= 0) {
      throw new BadRequestException('Uploaded song file is empty.');
    }
  }

  private titleFromFilename(filename: string) {
    const ext = extname(filename);
    return basename(filename, ext);
  }

  private async writeTrackToDisk(userId: string, track: UploadedTrack) {
    const userDirectory = join(this.musicRoot, userId);
    await fs.mkdir(userDirectory, { recursive: true });
    const filePath = join(userDirectory, track.originalFilename);
    await fs.writeFile(filePath, track.buffer);
  }

  private async waitForScan() {
    await this.navidromeJson('startScan', {});
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  private async findNavidromeSongByTitle(title: string) {
    const search = await this.navidromeJson('search3', {
      query: title,
      songCount: 20,
      albumCount: 0,
      artistCount: 0,
    });

    const songs = this.normalizeSongs(search.searchResult3?.song);
    const exact = songs.find((song) => {
      const songTitle = typeof song.title === 'string' ? song.title.toLowerCase() : '';
      return songTitle === title.toLowerCase();
    });

    return exact ?? songs[0];
  }

  private async saveTrackRecord(userId: string, track: UploadedTrack): Promise<Song> {
    const matched = await this.findNavidromeSongByTitle(track.title);
    const navidromeId = typeof matched?.id === 'string' ? matched.id : undefined;

    if (!navidromeId) {
      throw new NotFoundException(`Uploaded song "${track.title}" was not found in Navidrome after scan.`);
    }

    return this.prisma.song.upsert({
      where: { navidromeId },
      update: {
        title: track.title,
        artist: track.artist ?? null,
        userId,
      },
      create: {
        navidromeId,
        title: track.title,
        artist: track.artist ?? null,
        userId,
      },
    });
  }

  async ingestUploadedTracks(
    files: Array<{ buffer: Buffer; originalname: string; size?: number }>,
    user: AuthUser,
    metadata?: Array<{ title?: string; artist?: string | null }>,
  ): Promise<Song[]> {
    const userId = this.getUserId(user);

    if (!files.length) {
      throw new BadRequestException('At least one song file is required.');
    }

    const tracks: UploadedTrack[] = files.map((file, index) => {
      const meta = metadata?.[index];
      const title = meta?.title?.trim() || this.titleFromFilename(file.originalname);
      const artist = meta?.artist?.trim() || null;

      const track = {
        title,
        artist,
        originalFilename: file.originalname,
        buffer: file.buffer,
        size: file.size,
      };

      this.validateMp3File(track);
      return track;
    });

    for (const track of tracks) {
      await this.writeTrackToDisk(userId, track);
    }

    await this.waitForScan();

    const savedSongs: Song[] = [];
    for (const track of tracks) {
      savedSongs.push(await this.saveTrackRecord(userId, track));
    }

    return savedSongs;
  }

  async uploadSong(
    file: { buffer: Buffer; originalname: string; size?: number } | undefined,
    body: UploadSongDto,
    user: AuthUser,
  ) {
    if (!file) {
      throw new BadRequestException('song file is required.');
    }

    const [savedSong] = await this.ingestUploadedTracks(
      [file],
      user,
      [{ title: body.title, artist: body.artist ?? null }],
    );

    return savedSong;
  }

  async searchSongs(dto: SearchSongsDto) {
    const result = await this.navidromeJson('search3', {
      query: dto.query,
      songCount: dto.limit ?? 20,
      albumCount: 0,
      artistCount: 0,
    });

    return this.normalizeSongs(result.searchResult3?.song);
  }

  buildStreamUrl(navidromeId: string) {
    const params = this.buildNavidromeParams({ id: navidromeId });
    return `${this.navidromeUrl.replace(/\/$/, '')}/rest/stream.view?${params.toString()}`;
  }

  getStreamUrl(navidromeId: string) {
    return {
      url: this.buildStreamUrl(navidromeId),
    };
  }

  async getMySongs(user: AuthUser) {
    const userId = this.getUserId(user);
    return this.prisma.song.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async deleteSong(id: string, user: AuthUser) {
    const userId = this.getUserId(user);
    const song = await this.ensureOwnedSong(id, userId);

    await this.prisma.song.delete({ where: { id: song.id } });

    return { message: 'Song deleted' };
  }
}
