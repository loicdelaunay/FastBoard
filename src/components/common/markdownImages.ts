/** Une image proposée par « Insérer une image » : sa vignette, et le Markdown qui l'affiche. */
export interface MarkdownImageChoice {
  key: string;
  name: string;
  thumb: string;
  markdown: string;
}

/**
 * Images d'un éditeur Markdown (description d'un ticket) : celles déjà disponibles, et l'envoi d'un fichier collé,
 * glissé ou importé. L'éditeur pose d'abord un repère (`token`) à l'endroit du curseur ; `upload` le remplace par le
 * Markdown final une fois le fichier envoyé (ou le retire en cas d'échec), dans le texte du parent : l'éditeur peut
 * s'être fermé entre-temps.
 */
export interface MarkdownImageSupport {
  choices: () => MarkdownImageChoice[];
  /** Phrase quand il n'y a encore aucune image à proposer. */
  emptyText: string;
  upload: (file: File, token: string) => void;
}
