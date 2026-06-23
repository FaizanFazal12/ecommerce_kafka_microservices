import { Module } from '@nestjs/common';
import { ProxyService } from './proxy.service';
import { OrdersProxyController } from './orders.proxy.controller';
import { RateLimitModule } from '../rate-limit/rate-limit.module';

@Module({
  imports: [RateLimitModule],
  controllers: [OrdersProxyController],
  providers: [ProxyService],
})
export class ProxyModule {}
