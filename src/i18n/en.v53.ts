/** Textes ajoutés en 2.29.0 : pièces jointes figées des versions étiquetées. */
export const enV53: Record<string, string> = {
  '{n} image figée avec l’étiquette, telle qu’elle était|{n} images figées avec l’étiquette, telles qu’elles étaient':
    '{n} image frozen with the tag, as it was|{n} images frozen with the tag, as they were',
  // Journal des modifications.
  'Mise à jour de la base : une base passée par la version de développement des pièces jointes figées sautait la création des groupes de personnes (« no such table: doc_access ») ; elle est réparée au démarrage.':
    'Database upgrade: a database that went through the development version of frozen attachments skipped the creation of people groups (“no such table: doc_access”); it is repaired at startup.',
  'Étiquettes de versions : les pièces jointes sont figées avec la version. Une note étiquetée garde ses images telles qu’elles étaient (même remplacées ou supprimées depuis, et pour une ancienne version, celles d’alors) ; un tableau étiqueté garde ses images et ses icônes ajoutées. Copier ou restaurer la version les remet dans l’espace, et les liens suivent.':
    'Version tags: attachments are frozen with the version. A tagged note keeps its images as they were (even if replaced or deleted since, and for an older version, the ones from back then); a tagged board keeps its images and added icons. Copying or restoring the version puts them back in the space, and the links follow.',
};
