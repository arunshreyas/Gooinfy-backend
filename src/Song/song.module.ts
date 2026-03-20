import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from 'src/prisma.service';
import { SongController } from './song.controller';
import { SongService } from './song.service';

@Module({
  imports: [ConfigModule],
  controllers: [SongController],
  providers: [SongService, PrismaService],
  exports: [SongService],
})
export class SongModule {}
