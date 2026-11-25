import { randomInt } from 'node:crypto';

/** Without I nor O, that a letter or a voice confuses with 1 and 0. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LENGTH = 4;
/** Read aloud or tried first: French words, first names, rows of a keyboard. */
const WORDS = new Set(
  [
    'ABUS ACDC ACTE AGES AMEN AMER AMES ANGE ANNA ANSE ANUS ARME ARTS AUBE AVEC AVEU AXES AZER BAGS BANC BARS BASE BATS BAVE BEAU BEBE BETE BLED',
    'BLEU BRAS BREF BRUT BUTS CAFE CAGE CALE CAMP CAPE CARS CAVE CELA CENT CERF CEUX CHAT CHEF CHER CLEF CLES CLUB CRAN CREE CREU CRUE CUBE CULS',
    'CURE DAME DANS DATE DEJA DENT DEUX DRAP DUCS DUEL DUES DUNE DUPE DURE ECHU ELAN ELLE ELUE EMMA EMUE ETAT ETES ETRE EVAN FACE FADE FAUX FETE',
    'FEUX FEVE FLAN FLUX FUEL GAGE GALA GANG GARE GARS GENE GENS GLAS GRAS GREC GRUE GUET HALL HALT HEUR HUEE HUGH HURE JADE JARS JAZZ JEAN JEST',
    'JETS JEUX JUGE JUPE JURA JURE JURY JUTE KARL KART KEYS LACS LAMA LAME LARA LARD LAVE LEGA LEGS LEST LEUR LEXA LUGE LUNE LUTH LUXE MAEL MALE',
    'MANS MARC MARK MARS MATE MATH MATS MAUX MENT MENU MERE MERS MESS METS MEUF MULE MURS MUSE NAEL NAGE NEES NEFS NERF NEUF NUES NULS PAGE PALE',
    'PAPA PARC PARE PARU PASS PATE PAUL PAYE PAYS PEAU PERD PERE PEUR PEUT PLAN PLAT PLUS PRES PRET PUBS PUCE PULL PURE PUTE QSDF QUAD QUEL QWER',
    'RACE RADE RAGE RALE RAME RANG RAPE RARE RATE RATS RAVE REEL RENE REST RHUM RUBY RUDE RUES RUSE SACS SAGE SALE SANG SANS SARA SAUF SAUT SEAU',
    'SECS SENS SENT SEPT SERT SEUL SEXE SLAM STAR SUCE SUDS SUER SURE TACT TAPE TARD TARE TAXE TEST TETE TETU THES THYM TRAC TREK TRES TUBE TUER',
    'TUES TYPE URGE USEE USER VASE VAUT VEAU VENT VERS VERT VETU VEUF VEUX VRAC VUES WEST WXCV YEUX YVES ZERT',
  ].flatMap((line) => line.split(' ')),
);
const ranked = (code: string) => [...code].map((letter) => CODE_ALPHABET.indexOf(letter));
/** What someone would try first: a word, a letter said again, letters in a row. */
export function isGuessable(code: string): boolean {
  const ranks = ranked(code);
  const steps = new Set(ranks.slice(1).map((rank, index) => rank - ranks[index]!));
  return WORDS.has(code) || new Set(code).size < 3 || (steps.size === 1 && [1, -1].includes([...steps][0]!));
}
export const isAccessCode = (value: string) => value.length === LENGTH && ranked(value).every((rank) => rank >= 0);

export function drawCode(pick: (max: number) => number = randomInt): string {
  for (;;) {
    const code = Array.from({ length: LENGTH }, () => CODE_ALPHABET[pick(CODE_ALPHABET.length)]!).join('');
    if (!isGuessable(code)) return code;
  }
}
