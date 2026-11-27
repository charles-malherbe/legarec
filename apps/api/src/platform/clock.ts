import { Injectable } from '@nestjs/common';

/** The hour it is, for what is judged on it (hours of the firm, caps): replaced in the tests, which run at any hour. */
@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }
}
