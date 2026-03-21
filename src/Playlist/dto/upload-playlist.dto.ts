import { IsNotEmpty, IsString } from 'class-validator';

export class UploadPlaylistDto {
  @IsString()
  @IsNotEmpty()
  name: string;
}
