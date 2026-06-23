import { Body, Controller, Post } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { IsUUID } from 'class-validator';

class TokenRequestDto {
  /** The customer to issue a token for. Demo only — no password/identity check. */
  @IsUUID()
  customerId!: string;
}

/**
 * Demo token issuer so the API is explorable end-to-end. In a real system this
 * would be a full identity provider (password / OAuth / OIDC); here we just mint
 * a signed JWT for a given customer id so reviewers can authenticate.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly jwt: JwtService) {}

  @Post('token')
  issue(@Body() dto: TokenRequestDto) {
    const accessToken = this.jwt.sign({ sub: dto.customerId });
    return { accessToken, tokenType: 'Bearer' };
  }
}
