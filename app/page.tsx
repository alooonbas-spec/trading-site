export default function Home() {
  return (
    <main style={styles.page}>
      
      {/* HERO / ИДЕЯ */}
      <section style={styles.hero}>
        <h1 style={styles.h1}>Alpha Capital Platform</h1>
        <p style={styles.sub}>
          Системная инвестиционная платформа с фокусом на риск-менеджмент, алгоритмы и устойчивую доходность.
        </p>

        <div style={styles.stats}>
          <div style={styles.card}>
            <h3>AUM</h3>
            <p>$12.4M</p>
          </div>
          <div style={styles.card}>
            <h3>YTD</h3>
            <p>+18.7%</p>
          </div>
          <div style={styles.card}>
            <h3>Markets</h3>
            <p>FX / Crypto / Metals</p>
          </div>
        </div>
      </section>

      {/* ПЛАТФОРМА */}
      <section style={styles.section}>
        <h2>Платформа</h2>
        <ul>
          <li>Алгоритмическая торговля + ручной контроль</li>
          <li>Макро-анализ и data-driven решения</li>
          <li>Риск-менеджмент в реальном времени</li>
        </ul>
      </section>

      {/* ПОДРАЗДЕЛЕНИЯ */}
      <section style={styles.section}>
        <h2>Подразделения</h2>
        <div style={styles.grid}>
          <div style={styles.box}>Trading Desk</div>
          <div style={styles.box}>Risk Management</div>
          <div style={styles.box}>Research</div>
        </div>
      </section>

      {/* КОМАНДА */}
      <section style={styles.section}>
        <h2>Команда</h2>
        <p>
          Небольшая высокоэффективная команда трейдеров, аналитиков и инженеров.
        </p>
      </section>

      {/* CTA */}
      <section style={styles.cta}>
        <h2>Стать инвестором</h2>
        <p>Оставьте заявку для доступа к платформе</p>
        <button style={styles.button}>Оставить заявку</button>
      </section>

    </main>
  );
}

const styles = {
  page: {
    fontFamily: "system-ui",
    background: "#0b0f19",
    color: "white",
    padding: "40px",
  },
  hero: {
    marginBottom: "60px",
  },
  h1: {
    fontSize: "48px",
    marginBottom: "10px",
  },
  sub: {
    color: "#aab3c5",
    maxWidth: "600px",
  },
  stats: {
    display: "flex",
    gap: "15px",
    marginTop: "30px",
  },
  card: {
    background: "#111827",
    padding: "20px",
    borderRadius: "12px",
    flex: 1,
  },
  section: {
    marginBottom: "50px",
  },
  grid: {
    display: "flex",
    gap: "15px",
  },
  box: {
    background: "#111827",
    padding: "20px",
    borderRadius: "12px",
    flex: 1,
    textAlign: "center",
  },
  cta: {
    background: "#111827",
    padding: "30px",
    borderRadius: "16px",
    textAlign: "center",
  },
  button: {
    marginTop: "10px",
    padding: "10px 20px",
    borderRadius: "8px",
    border: "none",
    cursor: "pointer",
  },
};