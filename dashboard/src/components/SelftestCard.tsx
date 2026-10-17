import type { SelftestEvent } from '../types/events';

/** Node 3's start-up self-test as reported by the board (not a bench test). */
export function SelftestCard({ selftest }: { selftest: SelftestEvent }) {
  const rows: [string, string, boolean][] = [
    ['CAN controller', selftest.can, selftest.can === 'ok'],
    ['OLED (I2C)', selftest.oled, selftest.oled.startsWith('ok')],
    ['Button A', selftest.buttonA, selftest.buttonA === 'released'],
    ['Button B', selftest.buttonB, selftest.buttonB === 'released'],
    ['Buzzer', selftest.buzzer, selftest.buzzer === 'enabled'],
    ['LEDs', selftest.leds, true],
  ];
  return (
    <section className="card selftest" aria-label="Node 3 self-test" data-testid="selftest">
      <h3>Node 3 start-up self-test · boot {selftest.bootId}</h3>
      <dl className="small">
        {rows.map(([k, v, ok]) => (
          <div key={k} className="contents">
            <dt>{k}</dt>
            <dd className={ok ? 'tone-ok' : 'tone-warn'}>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
