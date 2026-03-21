import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PlaylistModule } from './Playlist/playlist.module';
import { PrismaModule } from './prisma.module';
import { SongModule } from './Song/song.module';
import { UserModule } from './User/user.module';
import { AuthModule } from './auth/auth.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    UserModule,
    AuthModule,
    SongModule,
    PlaylistModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
