import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ATTENTION_CHANGED, AttentionEvents, AttentionService } from '../attention/index.js';
import {
  DEVICE_CHANGED,
  DeviceEvents,
  DevicesRepository,
  HARDWARE_CHANGED,
  HardwareRepository,
  toDevice,
  toHardware,
  type DeviceChanged,
  type HardwareChanged,
} from '../devices/index.js';
import {
  GATEWAY_REGISTERED,
  GATEWAY_REVOKED,
  GATEWAY_STATUS_CHANGED,
  GATEWAY_TOUCHED,
  GatewayEvents,
  GatewaysService,
} from '../gateways/index.js';
import { describeError } from '../../platform/errors/index.js';
import { Coalescer } from './coalescer.js';
import { LiveHub } from './live-hub.js';
import { LIVE_OPTIONS, type LiveOptions } from './live.options.js';

const GATEWAY_EVENTS = [
  GATEWAY_STATUS_CHANGED,
  GATEWAY_REGISTERED,
  GATEWAY_REVOKED,
  GATEWAY_TOUCHED,
] as const;

/**
 * Turns the internal events into live events: the DTO is built once per event (not per stream),
 * at most one event per object and window, and only while somebody watches. Listeners never throw
 * into the emitter; a failing build is logged (without data) and that event is dropped.
 */
@Injectable()
export class LivePublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LivePublisher.name);
  private readonly coalescer: Coalescer;

  constructor(
    private readonly hub: LiveHub,
    private readonly deviceEvents: DeviceEvents,
    private readonly gatewayEvents: GatewayEvents,
    private readonly attentionEvents: AttentionEvents,
    private readonly devices: DevicesRepository,
    private readonly hardware: HardwareRepository,
    private readonly gateways: GatewaysService,
    private readonly attention: AttentionService,
    @Inject(LIVE_OPTIONS) options: LiveOptions,
  ) {
    this.coalescer = new Coalescer(options.throttleMs, (error) => {
      this.logger.warn(`Cannot build a live event: ${describeError(error)}`);
    });
  }

  onModuleInit(): void {
    this.deviceEvents.on(DEVICE_CHANGED, this.onDevice);
    this.deviceEvents.on(HARDWARE_CHANGED, this.onHardware);
    for (const event of GATEWAY_EVENTS) this.gatewayEvents.on(event, this.onGateway);
    this.attentionEvents.on(ATTENTION_CHANGED, this.onAttention);
  }

  onModuleDestroy(): void {
    this.deviceEvents.off(DEVICE_CHANGED, this.onDevice);
    this.deviceEvents.off(HARDWARE_CHANGED, this.onHardware);
    for (const event of GATEWAY_EVENTS) this.gatewayEvents.off(event, this.onGateway);
    this.attentionEvents.off(ATTENTION_CHANGED, this.onAttention);
    this.coalescer.dispose();
  }

  private readonly onDevice = (event: DeviceChanged): void => {
    this.listen(() => {
      this.coalescer.schedule(`device:${event.deviceId}`, async () => {
        if (!this.hub.watching(event.householdId)) return;
        const view = await this.devices.get(event.householdId, event.deviceId);
        if (view) this.hub.publish(event.householdId, 'device.state', toDevice(view), 'viewer');
      });
    });
  };

  private readonly onHardware = (event: HardwareChanged): void => {
    this.listen(() => {
      this.coalescer.schedule(`hardware:${event.hardwareId}`, async () => {
        const found = await this.hardware.listingOf(event.hardwareId);
        if (!found || !this.hub.watching(found.householdId)) return;
        if (found.listed) {
          this.hub.publish(
            found.householdId,
            'hardware.updated',
            toHardware(found.listed),
            'owner',
          );
        } else {
          this.hub.publish(
            found.householdId,
            'hardware.removed',
            { id: event.hardwareId },
            'owner',
          );
        }
      });
    });
  };

  private readonly onGateway = (event: { gatewayId: string }): void => {
    this.listen(() => {
      this.coalescer.schedule(`gateway:${event.gatewayId}`, async () => {
        const found = await this.gateways.find(event.gatewayId);
        if (!found || !this.hub.watching(found.householdId)) return;
        this.hub.publish(found.householdId, 'gateway.status', found.gateway, 'owner');
      });
    });
  };

  private readonly onAttention = (event: { householdId: string }): void => {
    this.listen(() => {
      this.coalescer.schedule(`attention:${event.householdId}`, () => {
        if (this.hub.watching(event.householdId)) {
          this.hub.publishByAudience(event.householdId, 'attention.changed', (audience) => ({
            items: this.attention.list(event.householdId, audience.role, audience.isPlatformAdmin),
          }));
        }
        return Promise.resolve();
      });
    });
  };

  /** Runs a listener body so that nothing thrown reaches the emitter. */
  private listen(body: () => void): void {
    try {
      body();
    } catch (error) {
      this.logger.warn(`Cannot schedule a live event: ${describeError(error)}`);
    }
  }
}
