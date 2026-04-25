export default function Home() {
  return (
    <main style={{fontFamily: "system-ui", padding: "40px", maxWidth: "900px", margin: "0 auto"}}>
      
      {/* ИДЕЯ */}
      <section>
        <h1>Investment Platform</h1>
        <p>
          Мы создаём системную платформу управления капиталом с фокусом на стабильную доходность
          и контролируемые риски.
        </p>
      </section>

      <hr />

      {/* ПЛАТФОРМА */}
      <section>
        <h2>Платформа</h2>
        <ul>
          <li>Алгоритмическая торговля</li>
          <li>Ручное управление позициями</li>
          <li>Аналитика рынков</li>
        </ul>
      </section>

      <hr />

      {/* ПОДРАЗДЕЛЕНИЯ */}
      <section>
        <h2>Подразделения</h2>
        <ul>
          <li>Trading Desk</li>
          <li>Risk Management</li>
          <li>Research</li>
        </ul>
      </section>

      <hr />

      {/* КОМАНДА */}
      <section>
        <h2>Команда</h2>
        <p>
          Небольшая команда специалистов в области трейдинга, аналитики и управления капиталом.
        </p>
      </section>

    </main>
  )
}