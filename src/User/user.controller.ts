import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { UserService } from './user.service';
import { createUserDto } from './dto/createUser.dto';
import { updateUserDto } from './dto/updateUser.dto';

@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  getUsers() {
    return this.userService.findall();
  }

  @Get(':id')
  getUser(@Param('id') id: string) {
    return this.userService.findOne(id);
  }
  @Post()
  createUser(@Body() body: createUserDto) {
    return this.userService.create(body);
  }
  @Patch(':id')
  updateUser(
    @Param('id') id: string,
    @Body() body: updateUserDto,
  ) {
    return this.userService.updateUser(id, body);
  }
}
