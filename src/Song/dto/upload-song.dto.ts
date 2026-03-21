import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UploadSongDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsOptional()
  @IsString()
  artist?: string;
}
