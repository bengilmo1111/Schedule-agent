// lib/prisma.js
import { PrismaClient } from "@prisma/client";

let prisma;
if (!global.prisma) {
  global.prisma = new PrismaClient();
}
export default global.prisma;
