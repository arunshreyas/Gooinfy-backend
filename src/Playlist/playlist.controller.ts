import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { AddPlaylistSongDto } from './dto/add-playlist-song.dto';
import { CreatePlaylistDto } from './dto/create-playlist.dto';
import { PlaylistService } from './playlist.service';

@Controller('playlists')
export class PlaylistController {
  constructor(private readonly playlistService: PlaylistService) {}

  @Post()
  createPlaylist(@Body() body: CreatePlaylistDto) {
    return this.playlistService.createPlaylist(body);
  }

  @Get()
  getPlaylists(@Query('userId') userId: string) {
    return this.playlistService.getPlaylists(userId);
  }

  @Get(':id')
  getPlaylist(@Param('id') id: string, @Query('userId') userId: string) {
    return this.playlistService.getPlaylist(id, userId);
  }

  @Post(':id/songs')
  addSongToPlaylist(@Param('id') id: string, @Body() body: AddPlaylistSongDto) {
    return this.playlistService.addSongToPlaylist(id, body);
  }

  @Delete(':id/songs/:songId')
  removeSongFromPlaylist(
    @Param('id') id: string,
    @Param('songId') songId: string,
    @Query('userId') userId: string,
  ) {
    return this.playlistService.removeSongFromPlaylist(id, songId, userId);
  }

  @Delete(':id')
  deletePlaylist(@Param('id') id: string, @Query('userId') userId: string) {
    return this.playlistService.deletePlaylist(id, userId);
  }
}
