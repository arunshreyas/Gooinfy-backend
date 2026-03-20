import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma.service';
import { createUserDto } from './dto/createUser.dto';
import { updateUserDto } from './dto/updateUser.dto';

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  private async ensureUserExists(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { playlists: false },
    });

    if (!user) {
      throw new NotFoundException(`User with id ${id} not found.`);
    }

    return user;
  }

  private parsePayload(data: unknown): Record<string, unknown> {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new BadRequestException('Request body must be a JSON object.');
    }

    const entries = Object.entries(data);
    if (entries.length === 1) {
      const [key, value] = entries[0];
      if (value === '' && key.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(key);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
          }
        } catch {
          throw new BadRequestException('Request body contains invalid JSON.');
        }
      }
    }  

    return data as Record<string, unknown>;
  }

  findall() {
    return this.prisma.user.findMany({
      orderBy: { id: 'asc' },
      include: { playlists: false },
    });
  }

  findOne(id: string) {
    return this.ensureUserExists(id);
  }

  create(data: createUserDto) {
    const payload = this.parsePayload(data);
    const username = payload.username;
    const email = payload.email;
    const password = payload.password;

    if (
      typeof username !== 'string' ||
      typeof email !== 'string' ||
      typeof password !== 'string'
    ) {
      throw new BadRequestException(
        'username, email, and password are required string fields.',
      );
    }

    return this.prisma.user.create({
      data: {
        username,
        email,
        password,
      },
    });
  }

  async updateUser(id: string, data: updateUserDto) {
    await this.ensureUserExists(id);

    const payload = this.parsePayload(data);
    const updateData: updateUserDto = {};

    if (typeof payload.username === 'string') {
      updateData.username = payload.username;
    }

    if (typeof payload.email === 'string') {
      updateData.email = payload.email;
    }

    if (typeof payload.password === 'string') {
      updateData.password = payload.password;
    }

    return this.prisma.user.update({
      where: { id },
      data: updateData,
    });
  }
}
