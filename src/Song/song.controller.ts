import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUser, type AuthUser } from 'src/common/decorators/current-user.decorator';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { SearchSongsDto } from './dto/search-songs.dto';
import { UploadSongDto } from './dto/upload-song.dto';
import { SongService } from './song.service';

@UseGuards(JwtAuthGuard)
@Controller('songs')
export class SongController {
  constructor(private readonly songService: SongService) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('song', {
      storage: memoryStorage(),
      limits: { fileSize: 25 * 1024 * 1024 },
    }),
  )
  uploadSong(
    @UploadedFile() file: { buffer: Buffer; originalname: string; size?: number } | undefined,
    @Body() body: UploadSongDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.songService.uploadSong(file, body, user);
  }

  @Get('search')
  searchSongs(@Query() query: SearchSongsDto) {
    return this.songService.searchSongs(query);
  }

  @Get('stream/:navidromeId')
  getStreamUrl(@Param('navidromeId') navidromeId: string) {
    return this.songService.getStreamUrl(navidromeId);
  }

  @Get('my')
  getMySongs(@CurrentUser() user: AuthUser) {
    return this.songService.getMySongs(user);
  }

  @Delete(':id')
  deleteSong(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.songService.deleteSong(id, user);
  }
}
