// MenuFooter – alkuvalikon footer-blokki.
//
// Sisältää: saavutus- ja käyttäjänappi (yläpalkki), sanamäärä-info,
// "Näin pelaat" + "Lue lisää sanoista" -linkit, versio, palaute/tietosuoja
// -linkit, ja kielilippuvalitsin.
//
// Tämä on koottu visuaalinen komponentti – App.jsx antaa propseina
// kaikki tarvittavat tiedot ja callbackit, eikä komponentti tunne
// sounds/socket/storage-yksityiskohtia.
//
// Props (data):
//   S, lang, t        konteksti
//   Icon, PixelFlag   parentista välitettävät komponentit (teema valinnut Icon)
//   version           "2.1.0" tai vastaava
//   langConfig        LANG_CONFIG-objekti ({ fi: {...}, sv: {...}, en: {...} })
//   authUser          { nickname, ... } | null
//   achUnlockedCount  monta saavutusta auki
//   achTotalCount     saavutuksia yhteensä
//   wordCount         WORDS_SET.size
//   wordsLoaded       onko sanalista jo ladattu
//
// Props (callbacks):
//   onShowAchievements
//   onShowAuth
//   onShowInflection
//   onShowHelp
//   onShowWordInfo
//   onLangChange(code)  – vaihtaa kielen ja persistoi

const TEXTS = {
  fi: {
    inflectionsLink: "(katso taivutusmuodot)",
    loading: "Ladataan sanalistaa...",
    feedback: "Palaute",
    privacy: "Tietosuoja",
    terms: "Käyttöehdot",
    about: "Tietoja",
    howToPlayPage: "Ohjeet",
  },
  sv: {
    loading: "Laddar ordlistan...",
    feedback: "Feedback",
    privacy: "Integritet",
    terms: "Villkor",
    about: "Om",
    howToPlayPage: "Guide",
  },
  en: {
    loading: "Loading word list...",
    feedback: "Feedback",
    privacy: "Privacy",
    terms: "Terms",
    about: "About",
    howToPlayPage: "Guide",
  },
};

export function MenuFooter({
  S,
  lang,
  t,
  Icon,
  PixelFlag,
  version,
  langConfig,
  authUser,
  achUnlockedCount,
  achTotalCount,
  wordCount,
  wordsLoaded,
  onShowAchievements,
  onShowAuth,
  onShowInflection,
  onShowHelp,
  onShowWordInfo,
  onLangChange,
}) {
  const txt = TEXTS[lang] || TEXTS.fi;

  return (
    <div style={{ marginTop: "20px", width: "100%", maxWidth: "600px" }}>
      {/* Saavutukset + Kirjautuminen -nappirivi */}
      <div
        style={{
          display: "flex",
          gap: "6px",
          justifyContent: "center",
          flexWrap: "wrap",
          marginBottom: "10px",
        }}
      >
        <button
          onClick={onShowAchievements}
          style={{
            fontFamily: S.font,
            fontSize: "13px",
            color: S.yellow,
            background: "transparent",
            border: `1px solid ${S.border}`,
            padding: "5px 10px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "5px",
            transition: "all 0.2s",
            minHeight: "32px",
            borderRadius: S.btnRadius,
          }}
        >
          <Icon icon="trophy" color={S.yellow} size={2} badge={true} />
          {achUnlockedCount > 0 && (
            <span style={{ fontSize: "12px" }}>
              {achUnlockedCount}/{achTotalCount}
            </span>
          )}
        </button>

        <button
          onClick={onShowAuth}
          style={{
            fontFamily: S.font,
            fontSize: "13px",
            color: authUser ? S.green : S.textMuted,
            background: "transparent",
            border: `1px solid ${authUser ? S.green + "66" : S.border}`,
            padding: "5px 10px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "5px",
            transition: "all 0.2s",
            minHeight: "32px",
            borderRadius: S.btnRadius,
          }}
        >
          <Icon icon="person" color={authUser ? S.green : S.textMuted} size={2} />
          {authUser && <span style={{ fontSize: "12px" }}>{authUser.nickname}</span>}
        </button>
      </div>

      {/* Sanamäärä-info */}
      <div style={{ fontSize: "12px", color: S.textMuted, marginBottom: "4px" }}>
        {wordsLoaded ? (
          lang === "fi" ? (
            <>
              {"~100 000 sanaa + "}
              {(wordCount - 100000).toLocaleString("fi-FI")}
              {" taivutusmuotoa "}
              <span
                onClick={onShowInflection}
                style={{
                  color: S.green,
                  cursor: "pointer",
                  textDecoration: "underline dotted",
                  textUnderlineOffset: "3px",
                  fontSize: "11px",
                }}
              >
                {txt.inflectionsLink}
              </span>
            </>
          ) : lang === "sv" ? (
            <>{wordCount.toLocaleString("fi-FI")} ord och böjningsformer</>
          ) : (
            <>{wordCount.toLocaleString("fi-FI")} words &amp; inflections</>
          )
        ) : (
          <span
            style={{
              color: S.textMuted,
              animation: "pulse 1.5s ease-in-out infinite",
            }}
          >
            {txt.loading}
          </span>
        )}
      </div>

      {/* Apulinkit */}
      <div
        style={{
          display: "flex",
          gap: "10px",
          justifyContent: "center",
          marginBottom: "4px",
        }}
      >
        <button
          onClick={onShowHelp}
          style={{
            fontFamily: S.font,
            fontSize: "12px",
            color: S.green,
            background: "transparent",
            border: "none",
            padding: "2px 4px",
            cursor: "pointer",
            textDecoration: "underline",
            opacity: 0.6,
          }}
        >
          {t.howToPlay}
        </button>
        <button
          onClick={onShowWordInfo}
          style={{
            fontFamily: S.font,
            fontSize: "12px",
            color: S.green,
            background: "transparent",
            border: "none",
            padding: "2px 4px",
            cursor: "pointer",
            textDecoration: "underline",
            opacity: 0.6,
          }}
        >
          {t.readMoreWords}
        </button>
      </div>

      {/* Versio + tekijä */}
      <div
        style={{ fontSize: "11px", color: S.textMuted + "88", marginTop: "2px" }}
      >
        v{version} · © Matti Kuokkanen 2026
      </div>

      {/* Palaute + Tietosuoja + Käyttöehdot + Tietoja + Ohjeet */}
      <div
        style={{
          fontSize: "12px",
          marginTop: "4px",
          display: "flex",
          gap: "10px",
          justifyContent: "center",
          flexWrap: "wrap",
        }}
      >
        <a
          href="mailto:info@piilosana.com"
          style={{ color: S.textMuted + "88", textDecoration: "none" }}
        >
          {txt.feedback}
        </a>
        <a
          href="/tietosuoja.html"
          style={{ color: S.textMuted + "88", textDecoration: "none" }}
        >
          {txt.privacy}
        </a>
        <a
          href="/kayttoehdot.html"
          style={{ color: S.textMuted + "88", textDecoration: "none" }}
        >
          {txt.terms}
        </a>
        <a
          href="/tietoja.html"
          style={{ color: S.textMuted + "88", textDecoration: "none" }}
        >
          {txt.about}
        </a>
        <a
          href="/ohjeet.html"
          style={{ color: S.textMuted + "88", textDecoration: "none" }}
        >
          {txt.howToPlayPage}
        </a>
      </div>

      {/* Kielilippuvalitsin */}
      <div
        style={{
          display: "flex",
          gap: "6px",
          justifyContent: "center",
          marginTop: "10px",
        }}
      >
        {Object.entries(langConfig).map(([code]) => (
          <button
            key={code}
            onClick={() => onLangChange(code)}
            style={{
              fontFamily: S.font,
              fontSize: "13px",
              background: lang === code ? S.dark : "transparent",
              border:
                lang === code
                  ? `1px solid ${S.green}`
                  : `1px solid ${S.border}`,
              padding: "5px 8px",
              cursor: "pointer",
              color: lang === code ? S.green : S.textMuted,
              boxShadow: lang === code ? `0 0 6px ${S.green}33` : "none",
              transition: "all 0.2s",
              display: "flex",
              alignItems: "center",
              gap: "4px",
              minHeight: "32px",
              borderRadius: S.btnRadius,
            }}
          >
            <PixelFlag lang={code} size={2} />
          </button>
        ))}
      </div>
    </div>
  );
}
