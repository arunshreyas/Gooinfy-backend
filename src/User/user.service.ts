import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import type { User } from '@prisma/client';
import { PrismaService } from 'src/prisma.service';
import { createUserDto } from './dto/createUser.dto';
import { updateUserDto } from './dto/updateUser.dto';

type SafeUser = Omit<User, 'password'>;

@Injectable()
export class UserService {
  private static readonly SALT_ROUNDS = 10;

  constructor(private readonly prisma: PrismaService) {}

  private sanitizeUser(user: User): SafeUser {
    const { password: _password, ...safeUser } = user;
    return safeUser;
  }

  private async ensureUserExists(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });

    if (!user) {
      throw new NotFoundException(`User with id ${id} not found.`);
    }

    return user;
  }

  private parsePayload(data: unknown): Record<string, unknown> {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new BadRequestException('Request body must be a JSON object.');
    }

    return data as Record<string, unknown>;
  }

  async findByIdentifier(identifier: string) {
    return this.prisma.user.findFirst({
      where: {
        OR: [{ email: identifier }, { username: identifier }],
      },
    });
  }

  async findByEmailOrUsername(email: string, username: string) {
    return this.prisma.user.findFirst({
      where: {
        OR: [{ email }, { username }],
      },
    });
  }

  async findall() {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return users.map((user) => this.sanitizeUser(user));
  }

  async findOne(id: string) {
    const user = await this.ensureUserExists(id);
    return this.sanitizeUser(user);
  }

  async getMe(id: string) {
    const user = await this.ensureUserExists(id);
    return this.sanitizeUser(user);
  }

  async create(data: createUserDto) {
    const payload = this.parsePayload(data);
    const username = payload.username;
    const email = payload.email;
    const password = payload.password;

    if (
      typeof username !== 'string' ||
      typeof email !== 'string' ||
      typeof password !== 'string'
    ) {
      throw new BadRequestException('username, email, and password are required string fields.');
    }

    const existing = await this.findByEmailOrUsername(email, username);
    if (existing) {
      throw new ConflictException('A user with that email or username already exists.');
    }

    const hashedPassword = await bcrypt.hash(password, UserService.SALT_ROUNDS);

    const user = await this.prisma.user.create({
      data: {
        username,
        email,
        password: hashedPassword,
      },
    });

    return this.sanitizeUser(user);
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
      updateData.password = await bcrypt.hash(payload.password, UserService.SALT_ROUNDS);
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: updateData,
    });

    return this.sanitizeUser(user);
  }
}
