import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { SearchSongsDto } from './dto/search-songs.dto';
import { UploadSongDto } from './dto/upload-song.dto';
import { SongService } from './song.service';

@Controller('songs')
export class SongController {
  constructor(private readonly songService: SongService) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 25 * 1024 * 1024 },
    }),
  )
  uploadSong(
    @UploadedFile() file: { buffer: Buffer; originalname: string; mimetype?: string; size?: number },
    @Body() body: UploadSongDto,
  ) {
    return this.songService.uploadSong(file, body.userId);
  }

  @Get('search')
  searchSongs(@Query() query: SearchSongsDto) {
    return this.songService.searchSongs(query);
  }

  @Get('my')
  getMySongs(@Query('userId') userId: string) {
    return this.songService.getMySongs(userId);
  }

  @Get('stream/:id')
  getStreamUrl(@Param('id') id: string, @Query('userId') userId: string) {
    return this.songService.getStreamUrl(id, userId);
  }

  @Delete(':id')
  deleteSong(@Param('id') id: string, @Query('userId') userId: string) {
    return this.songService.deleteSong(id, userId);
  }
}
