import { Column, Entity, PrimaryColumn } from 'typeorm';

export type SimulatorStatus = 'starting' | 'running' | 'stopped' | 'error';

@Entity({ name: 'simulator_state' })
export class SimulatorStateEntity {
  @PrimaryColumn('text')
  id!: string;

  @Column('text', { default: 'stopped' })
  status!: SimulatorStatus;

  @Column({ type: 'text', default: '0' })
  transactionCount!: string;

  @Column({ type: 'text', default: '0' })
  totalVolumeStroops!: string;

  @Column({ type: 'float', default: 30 })
  intervalMinutes!: number;

  @Column({ type: 'text', default: '1' })
  minAmountXlm!: string;

  @Column({ type: 'text', default: '1' })
  maxAmountXlm!: string;
}
