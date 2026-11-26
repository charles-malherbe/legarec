import { notificationItem, REQUEST_BODIES, type NotificationItem } from '@legarec/contracts';
import { Body, Controller, Get, HttpCode, Inject, Post, Put } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AnyStaff } from '../../platform/access/access';
import { Database } from '../../platform/database/database';
import { NotificationsService } from './notifications.service';

const bodies = REQUEST_BODIES.staff;

@ApiTags('notifications')
@Controller('staff/notifications')
@AnyStaff()
export class NotificationsController {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  @Get()
  @ApiOkResponse({ standardSchema: z.array(notificationItem) })
  list(): Promise<NotificationItem[]> {
    return this.notifications.list();
  }

  @Put()
  @HttpCode(204)
  @ApiNoContentResponse()
  async mark(@Body({ schema: bodies['PUT /notifications'] }) { ids, unread }: z.infer<(typeof bodies)['PUT /notifications']>) {
    await this.read(ids, unread);
  }

  @Post('read')
  @HttpCode(204)
  @ApiNoContentResponse()
  async markRead(@Body({ schema: bodies['POST /notifications/read'] }) { ids }: z.infer<(typeof bodies)['POST /notifications/read']>) {
    await this.read(ids, false);
  }

  private async read(ids: string[], unread: boolean): Promise<void> {
    await this.database.tx.notification.updateMany({
      where: { id: { in: ids }, readAt: unread ? { not: null } : null },
      data: { readAt: unread ? null : new Date() },
    });
  }
}
