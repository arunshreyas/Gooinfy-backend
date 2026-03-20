import { IsNotEmpty, IsString } from 'class-validator';

export class UploadSongDto {
  @IsString()
  @IsNotEmpty()
  userId: string;
}
