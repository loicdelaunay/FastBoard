import type { SearchNode } from '@shared/noteSearch';
import { t } from '@/i18n';

/** Messages d'erreur de `parseNoteSearch`, pour la traduction (le test des traductions les lit ici). */
export const SEARCH_ERRORS = [
  t('Terme manquant.'),
  t('Parenthèse non fermée.'),
  t('Parenthèse fermante en trop.'),
  t('Saisie incomplète.'),
  t('Expression régulière invalide.'),
  t('Terme manquant : écrivez par exemple match-case:Mot.'),
  t('Étiquette manquante : écrivez par exemple tag:#projet.'),
  t('Termes manquants : écrivez par exemple line:(a b).'),
];

/** Phrase qui dit comment la recherche est comprise, comme « Expliquer les termes de recherche » d'Obsidian. */
export function explainSearch(node: SearchNode): string {
  switch (node.kind) {
    case 'term': {
      const what = node.type === 'tag' ? t('l’étiquette {tag}', { tag: node.label }) : node.type === 'regex' ? t('l’expression {regex}', { regex: node.label }) : t('« {text} »', { text: node.label });
      return node.caseSensitive ? t('{what} (casse respectée)', { what }) : what;
    }
    case 'and':
      return node.items.map((item) => (item.negate ? t('sans {what}', { what: explainSearch(item.node) }) : explainSearch(item.node))).join(t(' et '));
    case 'or':
      return node.alternatives.map(explainSearch).join(t(' ou '));
    case 'scope': {
      const inner = node.inner ? explainSearch(node.inner) : '';
      switch (node.scope) {
        case 'line':
          return t('sur une même ligne : {what}', { what: inner });
        case 'section':
          return t('sous un même titre : {what}', { what: inner });
        case 'task':
          return inner ? t('dans une tâche : {what}', { what: inner }) : t('toute tâche');
        case 'task-todo':
          return inner ? t('dans une tâche à faire : {what}', { what: inner }) : t('toute tâche à faire');
        case 'task-done':
          return inner ? t('dans une tâche faite : {what}', { what: inner }) : t('toute tâche faite');
      }
    }
  }
}

/** Options de recherche proposées dans l'aide de la barre (exemple à insérer, et ce qu'il fait). */
export function searchTips(): Array<{ example: string; text: string }> {
  return [
    { example: '"phrase exacte"', text: t('Ces mots, dans cet ordre') },
    { example: 'a OR b', text: t('L’un ou l’autre') },
    { example: 'a -b', text: t('a, si b n’est pas dans la note (ou la ligne, la section)') },
    { example: '/\\d{4}-\\d{2}/', text: t('Expression régulière') },
    { example: 'match-case:Mot', text: t('Respecte la casse pour ce terme (ignore-case: l’ignore)') },
    { example: 'tag:#projet', text: t('Une étiquette') },
    { example: 'task-todo:', text: t('Tâches à faire (task: toutes, task-done: faites), ou un mot dedans : task-todo:test') },
    { example: 'line:(a b)', text: t('a et b sur une même ligne') },
    { example: 'section:(a b)', text: t('a et b sous un même titre') },
    { example: '**gras**', text: t('La syntaxe Markdown, en écriture ou en « Lecture et écriture » où elle s’affiche') },
  ];
}
