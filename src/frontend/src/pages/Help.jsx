import React from 'react';

const steps = [
  {
    title: '1. Vytvor novú prechádzku',
    text: 'Klikni na "New" v menu. Zadaj názov prechádzky a nastav dĺžku videa v sekundách.',
  },
  {
    title: '2. Označ body na mape',
    text: 'Klikni na mapu a pridaj aspoň 2 body (štart a cieľ). Appka nájde trasu medzi nimi automaticky. Môžeš pridať aj viac bodov - trasa pôjde cez všetky postupne.',
  },
  {
    title: '3. Použi vyhľadávanie',
    text: 'Do vyhľadávania napíš aspoň 5 znakov (napr. "Bratislava" alebo "Arenales del Sol"). Výsledky sa zobrazia automaticky. Kliknutím na výsledok sa mapa presunie na dané miesto. Tlačidlom "+" pridáš miesto ako bod trasy.',
  },
  {
    title: '4. Nastav kameru',
    text: 'Posuvníkmi nastavíš ako bude kamera pozerať:',
    items: [
      'Heading Offset - doľava/doprava od smeru chôdze (0° = rovno)',
      'Pitch - hore/dole (0° = rovno, kladné = hore)',
      'FOV / Zoom - priblíženie (nižšie číslo = viac priblížené)',
    ],
  },
  {
    title: '5. Ulož prechádzku',
    text: 'Klikni "Create Walk". Prechádzka sa uloží a presmeruje ťa na detail.',
  },
  {
    title: '6. Generuj video',
    text: 'Na detaile prechádzky klikni "Generate Video". Najprv sa zobrazí odhad ceny - koľko to bude stáť a koľko requestov sa pošle. Po potvrdení sa spustí generovanie.',
  },
  {
    title: '7. Sleduj priebeh',
    text: 'Počas generovania vidíš progress bar a log okno s detailnými informáciami. Ak sa niečo zasekne, použi tlačidlo "Reprocess".',
  },
  {
    title: '8. Stiahni video',
    text: 'Po dokončení sa zobrazí video prehrávač a tlačidlo na stiahnutie. Video nájdeš aj v sekcii "Gallery".',
  },
];

const tips = [
  'Kratšie trasy = lacnejšie. Každých 15 metrov sa stiahne jeden obrázok zo Street View.',
  'Nie všade je Street View dostupný. Na niektorých miestach môžu chýbať obrázky.',
  'Najprv priblíž mapu na oblasť kde chceš trasu, potom vyhľadávaj - výsledky budú presnejšie.',
  'Ak chceš video kde sa pozeráš do strany (napr. na budovy), nastav Heading Offset.',
  'Video sa dá kedykoľvek pregenerovať s inými nastaveniami - stačí zmazať video a upraviť walk.',
];

export default function Help() {
  return (
    <div className="page help-page">
      <div className="page-header">
        <h2>Ako to funguje</h2>
      </div>

      <div className="help-content">
        <div className="info-card help-intro">
          <p>
            Web Walk vytvorí video prechádzku z Google Street View obrázkov.
            Vyberieš trasu na mape a appka stiahne obrázky pozdĺž celej trasy
            a spojí ich do plynulého videa.
          </p>
        </div>

        <div className="info-card">
          <h3>Postup krok za krokom</h3>
          {steps.map((step, i) => (
            <div key={i} className="help-step">
              <h4>{step.title}</h4>
              <p>{step.text}</p>
              {step.items && (
                <ul className="help-list">
                  {step.items.map((item, j) => (
                    <li key={j}>{item}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>

        <div className="info-card">
          <h3>Tipy</h3>
          <ul className="help-list">
            {tips.map((tip, i) => (
              <li key={i}>{tip}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
