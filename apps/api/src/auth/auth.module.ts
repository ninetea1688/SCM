import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { type AppConfig, CONFIG } from '../config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtGuard } from './jwt.guard';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [CONFIG],
      useFactory: (cfg: AppConfig) => ({ secret: cfg.JWT_SECRET }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtGuard],
  exports: [AuthService, JwtGuard],
})
export class AuthModule {}
