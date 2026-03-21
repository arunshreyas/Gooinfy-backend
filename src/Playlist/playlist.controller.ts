import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUser, type AuthUser } from 'src/common/decorators/current-user.decorator';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { SongService } from 'src/Song/song.service';
import { AddPlaylistSongDto } from './dto/add-playlist-song.dto';
import { CreatePlaylistDto } from './dto/create-playlist.dto';
import { UploadPlaylistDto } from './dto/upload-playlist.dto';
import { PlaylistService } from './playlist.service';

@UseGuards(JwtAuthGuard)
@Controller('playlists')
export class PlaylistController {
  constructor(private readonly playlistService: PlaylistService) {}

  @Post('upload')
  @UseInterceptors(
    FilesInterceptor('songs', 50, {
      storage: memoryStorage(),
      limits: { fileSize: 25 * 1024 * 1024 },
    }),
  )
  uploadPlaylist(
    @UploadedFiles() files: Array<{ buffer: Buffer; originalname: string; size?: number }>,
    @Body() body: UploadPlaylistDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.playlistService.uploadPlaylist(files ?? [], body, user);
  }

  @Post()
  createPlaylist(@Body() body: CreatePlaylistDto, @CurrentUser() user: AuthUser) {
    return this.playlistService.createPlaylist(body, user);
  }

  @Get()
  getPlaylists(@CurrentUser() user: AuthUser) {
    return this.playlistService.getPlaylists(user);
  }

  @Get(':id')
  getPlaylist(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.playlistService.getPlaylist(id, user);
  }

  @Post(':id/songs')
  addSongToPlaylist(
    @Param('id') id: string,
    @Body() body: AddPlaylistSongDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.playlistService.addSongToPlaylist(id, body, user);
  }

  @Delete(':id/songs/:songId')
  removeSongFromPlaylist(
    @Param('id') id: string,
    @Param('songId') songId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.playlistService.removeSongFromPlaylist(id, songId, user);
  }

  @Delete(':id')
  deletePlaylist(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.playlistService.deletePlaylist(id, user);
  }
}
