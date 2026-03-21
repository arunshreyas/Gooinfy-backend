import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Song } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import type { AuthUser } from 'src/common/decorators/current-user.decorator';
import { PrismaService } from 'src/prisma.service';
import { SongService } from 'src/Song/song.service';
import { AddPlaylistSongDto } from './dto/add-playlist-song.dto';
import { CreatePlaylistDto } from './dto/create-playlist.dto';
import { UploadPlaylistDto } from './dto/upload-playlist.dto';

@Injectable()
export class PlaylistService {
  private readonly navidromeUrl: string;
  private readonly navidromeUser: string;
  private readonly navidromePass: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly songService: SongService,
  ) {
    this.navidromeUrl = this.configService.get<string>('NAVIDROME_URL') ?? 'http://localhost:4533';
    this.navidromeUser = this.configService.get<string>('NAVIDROME_USER') ?? 'mobbu';
    this.navidromePass = this.configService.get<string>('NAVIDROME_PASS') ?? 'm3%26Mango';
  }

  private getUserId(user: AuthUser): string {
    const userId = user.id ?? user.userId ?? user.sub;
    if (!userId) {
      throw new ForbiddenException('Authenticated user id is missing from JWT payload.');
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
        playlist?: { id?: string };
      };
    };

    if (!response.ok || data['subsonic-response']?.status !== 'ok') {
      throw new NotFoundException(
        data['subsonic-response']?.error?.message ?? `Navidrome ${endpoint} failed.`,
      );
    }

    return data['subsonic-response'];
  }

  private async getOwnedPlaylistOrThrow(id: string, userId: string) {
    const playlist = await this.prisma.playlist.findUnique({
      where: { id },
      include: {
        songs: {
          include: { song: true },
          orderBy: { order: 'asc' },
        },
      },
    });

    if (!playlist) {
      throw new NotFoundException(`Playlist with id ${id} not found.`);
    }

    if (playlist.userId !== userId) {
      throw new ForbiddenException('You do not own this playlist.');
    }

    return playlist;
  }

  async uploadPlaylist(
    files: Array<{ buffer: Buffer; originalname: string; size?: number }>,
    body: UploadPlaylistDto,
    user: AuthUser,
  ) {
    const userId = this.getUserId(user);
    const savedSongs: Song[] = await this.songService.ingestUploadedTracks(files, user);
    const payload = await this.navidromeJson('createPlaylist', { name: body.name });
    const navidromeId = payload.playlist?.id;

    if (!navidromeId) {
      throw new NotFoundException('Navidrome did not return a playlist id.');
    }

    const playlist = await this.prisma.playlist.create({
      data: {
        navidromeId,
        name: body.name,
        userId,
        songs: {
          create: savedSongs.map((song, index) => ({
            songId: song.id,
            order: index + 1,
          })),
        },
      },
      include: {
        songs: {
          include: { song: true },
          orderBy: { order: 'asc' },
        },
      },
    });

    for (const song of savedSongs) {
      await this.navidromeJson('updatePlaylist', {
        playlistId: navidromeId,
        songIdToAdd: song.navidromeId,
      });
    }

    return {
      message: 'Playlist uploaded successfully',
      playlist: {
        ...playlist,
        songs: playlist.songs.map((entry) => ({
          ...entry,
          streamUrl: this.songService.buildStreamUrl(entry.song.navidromeId),
        })),
      },
    };
  }

  async createPlaylist(body: CreatePlaylistDto, user: AuthUser) {
    const userId = this.getUserId(user);
    const payload = await this.navidromeJson('createPlaylist', { name: body.name });
    const navidromeId = payload.playlist?.id;

    if (!navidromeId) {
      throw new NotFoundException('Navidrome did not return a playlist id.');
    }

    return this.prisma.playlist.create({
      data: {
        navidromeId,
        name: body.name,
        userId,
      },
    });
  }

  async getPlaylists(user: AuthUser) {
    const userId = this.getUserId(user);
    return this.prisma.playlist.findMany({
      where: { userId },
      include: {
        songs: {
          include: { song: true },
          orderBy: { order: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getPlaylist(id: string, user: AuthUser) {
    const userId = this.getUserId(user);
    return this.getOwnedPlaylistOrThrow(id, userId);
  }

  async addSongToPlaylist(id: string, body: AddPlaylistSongDto, user: AuthUser) {
    const userId = this.getUserId(user);
    const playlist = await this.getOwnedPlaylistOrThrow(id, userId);

    const song = await this.prisma.song.findUnique({ where: { id: body.songId } });
    if (!song) {
      throw new NotFoundException(`Song with id ${body.songId} not found.`);
    }

    const existing = await this.prisma.playlistSong.findFirst({
      where: { playlistId: playlist.id, songId: song.id },
    });
    if (existing) {
      throw new ConflictException('Song already exists in this playlist.');
    }

    const order = await this.prisma.playlistSong.count({ where: { playlistId: playlist.id } }) + 1;

    await this.prisma.playlistSong.create({
      data: {
        playlistId: playlist.id,
        songId: song.id,
        order,
      },
    });

    await this.navidromeJson('updatePlaylist', {
      playlistId: playlist.navidromeId,
      songIdToAdd: song.navidromeId,
    });

    return { message: 'Song added to playlist' };
  }

  async removeSongFromPlaylist(id: string, songId: string, user: AuthUser) {
    const userId = this.getUserId(user);
    const playlist = await this.getOwnedPlaylistOrThrow(id, userId);

    const playlistSong = await this.prisma.playlistSong.findFirst({
      where: { playlistId: playlist.id, songId },
    });

    if (!playlistSong) {
      throw new NotFoundException(`Song with id ${songId} is not in this playlist.`);
    }

    await this.prisma.playlistSong.delete({ where: { id: playlistSong.id } });

    return { message: 'Song removed from playlist' };
  }

  async deletePlaylist(id: string, user: AuthUser) {
    const userId = this.getUserId(user);
    const playlist = await this.getOwnedPlaylistOrThrow(id, userId);

    await this.navidromeJson('deletePlaylist', { id: playlist.navidromeId });
    await this.prisma.playlist.delete({ where: { id: playlist.id } });

    return { message: 'Playlist deleted' };
  }
}
