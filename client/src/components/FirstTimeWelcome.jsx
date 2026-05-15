// FirstTimeWelcome – tervetulobanneri ensikertalaisille.
//
// Näkyy alkuvalikossa kun pelaaja ei ole vielä pelannut yhtään peliä
// loppuun (achStats.gamesPlayed === 0). Selittää pelin idean yhdellä
// lauseella ja tarjoaa harjoittelun ensimmäiseksi vaiheeksi.
//
// Filosofia: emme pakota mitään. Daily Piilosana on edelleen klikattava
// alapuolella. Bannerin tarkoitus on antaa pelaajalle vaihtoehto saada
// kokemus pelistä ennen kuin hän käyttää päivän ainoan yrityksensä.
//
// Häviää automaattisesti pelaajan ensimmäisen suoritetun pelin jälkeen.
//
// Props:
//   S, lang
//   isFirstTime    boolean – onko pelaaja ensikertalainen
//   onTryPractice  klikkauskäsittelijä (avaa harjoittelun asetukset)

const TEXTS = {
  fi: {
    title: "Tervetuloa Sanapiiloon!",
    body: "Vedä sormi kirjainten yli ja etsi sanoja. Mitä pidempi sana, sitä enemmän pisteitä.",
    cta: "Aloita harjoittelulla",
    hint: "Päivän haaste on alla – se on yksi yritys per päivä, joten kokeile peliä ensin tästä.",
  },
  sv: {
    title: "Välkommen till Sanapiilo!",
    body: "Dra med fingret över bokstäverna och hitta ord. Ju längre ord desto mer poäng.",
    cta: "Starta med övning",
    hint: "Dagens utmaning är nedanför – den är ett försök per dag, så prova spelet här först.",
  },
  en: {
    title: "Welcome to Sanapiilo!",
    body: "Drag your finger across the letters to find words. Longer words mean more points.",
    cta: "Start with practice",
    hint: "Today's challenge is below — it's one attempt per day, so try the game here first.",
  },
};

export function FirstTimeWelcome({ S, lang, isFirstTime, onTryPractice }) {
  if (!isFirstTime) return null;

  const txt = TEXTS[lang] || TEXTS.fi;

  return (
    <div
      style={{
        fontFamily: S.font,
        width: "100%",
        marginBottom: "12px",
        padding: "16px 18px",
        background: "linear-gradient(135deg,#dfe7d8,#cfdcc4)",
        border: "2px solid #aeb99b",
        borderRadius: "14px",
        color: "#314733",
        boxShadow: "0 6px 16px rgba(57,45,28,0.12)",
        animation: "fadeIn 0.5s ease",
      }}
    >
      <div
        style={{
          fontSize: "16px",
          fontWeight: "800",
          marginBottom: "8px",
          letterSpacing: "0.3px",
        }}
      >
        👋 {txt.title}
      </div>
      <div
        style={{
          fontSize: "13px",
          fontWeight: "500",
          lineHeight: 1.5,
          marginBottom: "10px",
        }}
      >
        {txt.body}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <button
          onClick={onTryPractice}
          style={{
            fontFamily: S.font,
            fontSize: "13px",
            fontWeight: "700",
            color: "#fff8ec",
            background: "linear-gradient(135deg,#6f9d8d,#558779)",
            border: "1px solid rgba(255,255,255,0.35)",
            padding: "10px 16px",
            cursor: "pointer",
            borderRadius: "10px",
            boxShadow: "0 4px 12px rgba(57,45,28,0.18)",
            transition: "transform 0.2s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = "translateY(-1px)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "none";
          }}
        >
          ▶ {txt.cta}
        </button>
        <span style={{ fontSize: "11px", color: "#5a6e54", lineHeight: 1.3, flex: 1, minWidth: "180px" }}>
          {txt.hint}
        </span>
      </div>
    </div>
  );
}
