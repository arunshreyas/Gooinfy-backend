import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "src/prisma.service";

@Injectable()
export class PlaylistService{
    constructor (
        private readonly prisma:PrismaService,
        private readonly configService: ConfigService,
    ){}
}