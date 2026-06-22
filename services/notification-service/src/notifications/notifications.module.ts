import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationEventsConsumer } from './notification-events.consumer';

@Module({
  providers: [NotificationsService, NotificationEventsConsumer],
})
export class NotificationsModule {}
