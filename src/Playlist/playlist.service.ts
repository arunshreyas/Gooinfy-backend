import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'src/prisma.service';
import { AddPlaylistSongDto } from './dto/add-playlist-song.dto';
import { CreatePlaylistDto } from './dto/create-playlist.dto';

@Injectable()
export class PlaylistService {
  private readonly navidromeUrl: string;
  private readonly navidromeUser: string;
  private readonly navidromePass: string;
  private readonly navidromeVersion: string;
  private readonly navidromeClient: string;

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
  }

  private requireUserId(userId: string | undefined): string {
    if (!userId?.trim()) {
      throw new BadRequestException('userId is required until JWT auth is wired.');
    }

    return userId;
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
        playlist?: Record<string, unknown>;
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

  private async ensureUserExists(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User with id ${userId} not found.`);
    }

    return user;
  }

  private async ensureOwnedPlaylist(playlistId: string, userId: string) {
    const playlist = await this.prisma.playlist.findFirst({
      where: { id: playlistId, userId },
      include: {
        songs: {
          include: { song: true },
          orderBy: { order: 'asc' },
        },
      },
    });

    if (!playlist) {
      throw new NotFoundException(`Playlist with id ${playlistId} not found for this user.`);
    }

    return playlist;
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

  async createPlaylist(dto: CreatePlaylistDto) {
    const userId = this.requireUserId(dto.userId);
    await this.ensureUserExists(userId);

    const songs = dto.songIds?.length
      ? await Promise.all(dto.songIds.map((songId) => this.ensureOwnedSong(songId, userId)))
      : [];

    const payload = await this.navidromeJson('createPlaylist', {
      name: dto.name,
    });

    const navidromePlaylistId = payload.playlist?.id;
    if (typeof navidromePlaylistId !== 'string') {
      throw new InternalServerErrorException('Navidrome did not return a playlist id.');
    }

    if (songs.length > 0) {
      const addParams = this.buildNavidromeParams({ playlistId: navidromePlaylistId });
      for (const song of songs) {
        addParams.append('songIdToAdd', song.navidromeId);
      }
      const baseUrl = this.navidromeUrl.replace(/\/$/, '');
      const response = await fetch(`${baseUrl}/rest/updatePlaylist.view?${addParams.toString()}`);
      const data = (await response.json()) as { 'subsonic-response'?: { status?: string; error?: { message?: string } } };
      if (!response.ok || data['subsonic-response']?.status !== 'ok') {
        throw new InternalServerErrorException(
          data['subsonic-response']?.error?.message ?? 'Failed to sync playlist songs to Navidrome.',
        );
      }
    }

    return this.prisma.playlist.create({
      data: {
        navidromeId: navidromePlaylistId,
        name: dto.name,
        userId,
        songs: songs.length
          ? {
              create: songs.map((song, index) => ({
                songId: song.id,
                order: index + 1,
              })),
            }
          : undefined,
      },
      include: {
        songs: {
          include: { song: true },
          orderBy: { order: 'asc' },
        },
      },
    });
  }

  async getPlaylists(userIdInput: string | undefined) {
    const userId = this.requireUserId(userIdInput);
    await this.ensureUserExists(userId);

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

  async getPlaylist(playlistId: string, userIdInput: string | undefined) {
    const userId = this.requireUserId(userIdInput);
    return this.ensureOwnedPlaylist(playlistId, userId);
  }

  async addSongToPlaylist(playlistId: string, dto: AddPlaylistSongDto) {
    const userId = this.requireUserId(dto.userId);
    const playlist = await this.ensureOwnedPlaylist(playlistId, userId);
    const song = await this.ensureOwnedSong(dto.songId, userId);

    const existing = playlist.songs.find((item) => item.songId === song.id);
    if (existing) {
      throw new BadRequestException('Song is already in this playlist.');
    }

    const nextOrder = dto.order ?? playlist.songs.length + 1;

    await this.navidromeJson('updatePlaylist', {
      playlistId: playlist.navidromeId,
      songIdToAdd: song.navidromeId,
    });

    await this.prisma.playlistSong.create({
      data: {
        playlistId: playlist.id,
        songId: song.id,
        order: nextOrder,
      },
    });

    return this.ensureOwnedPlaylist(playlistId, userId);
  }

  async removeSongFromPlaylist(
    playlistId: string,
    songId: string,
    userIdInput: string | undefined,
  ) {
    const userId = this.requireUserId(userIdInput);
    const playlist = await this.ensureOwnedPlaylist(playlistId, userId);
    const songIndex = playlist.songs.findIndex((entry) => entry.songId === songId);

    if (songIndex === -1) {
      throw new NotFoundException(`Song with id ${songId} is not in this playlist.`);
    }

    await this.navidromeJson('updatePlaylist', {
      playlistId: playlist.navidromeId,
      songIndexToRemove: songIndex,
    });

    await this.prisma.playlistSong.deleteMany({
      where: {
        playlistId,
        songId,
      },
    });

    const remainingSongs = playlist.songs.filter((entry) => entry.songId !== songId);
    await Promise.all(
      remainingSongs.map((entry, index) =>
        this.prisma.playlistSong.update({
          where: { id: entry.id },
          data: { order: index + 1 },
        }),
      ),
    );

    return this.ensureOwnedPlaylist(playlistId, userId);
  }

  async deletePlaylist(playlistId: string, userIdInput: string | undefined) {
    const userId = this.requireUserId(userIdInput);
    const playlist = await this.ensureOwnedPlaylist(playlistId, userId);

    await this.navidromeJson('deletePlaylist', { id: playlist.navidromeId });
    await this.prisma.$transaction([
      this.prisma.playlistSong.deleteMany({ where: { playlistId: playlist.id } }),
      this.prisma.playlist.delete({ where: { id: playlist.id } }),
    ]);

    return {
      message: 'Playlist deleted successfully.',
      playlistId: playlist.id,
      navidromeId: playlist.navidromeId,
    };
  }
}
