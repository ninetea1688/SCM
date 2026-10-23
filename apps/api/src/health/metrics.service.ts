/**
 * OPS-03: Prometheus metrics — publish outcomes per platform, queue depth and the
 * default process/HTTP collectors. Scraped from GET /metrics (internal network).
 */
import { Inject, Injectable } from '@nestjs/common';
import client from 'prom-client';
import { type AppConfig, CONFIG } from '../config';

@Injectable()
export class MetricsService {
  readonly registry = new client.Registry();
  readonly publishOutcomes: client.Counter<string>;
  readonly queueWaiting: client.Gauge<string>;

  constructor(@Inject(CONFIG) cfg: AppConfig) {
    this.registry.setDefaultLabels({ app: 'scm-api', env: cfg.NODE_ENV });
    client.collectDefaultMetrics({ register: this.registry });

    this.publishOutcomes = new client.Counter({
      name: 'scm_publish_attempts_total',
      help: 'Publish attempts by platform and final outcome (PUB-03/OPS-03)',
      labelNames: ['platform', 'outcome'] as const,
      registers: [this.registry],
    });
    this.queueWaiting = new client.Gauge({
      name: 'scm_publish_queue_waiting',
      help: 'Publish jobs waiting/delayed in the queue (OPS-03)',
      labelNames: ['state'] as const,
      registers: [this.registry],
    });
  }

  async render(): Promise<string> {
    return this.registry.metrics();
  }
}
