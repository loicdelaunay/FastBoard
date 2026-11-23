/** Textes ajoutés en 2.15 : réglages de réflexion des modèles de l'assistant. */
export const enV37: Record<string, string> = {
  'Personnalisé': 'Custom',
  'Le modèle a des réglages de réflexion ; le bouton choisit ceux proposés dans le panneau': 'The model has thinking settings; the button chooses those offered in the panel',
  'Réglages de réflexion proposés dans le panneau': 'Thinking settings offered in the panel',
  'JSON invalide.': 'Invalid JSON.',
  'Écrivez un objet JSON, par exemple { "reasoning_effort": "high" }.': 'Write a JSON object, for example { "reasoning_effort": "high" }.',
  '« {key} » est fixé par FastBoard et ne peut pas être remplacé.': '“{key}” is set by FastBoard and cannot be replaced.',
  'Paramètres trop longs.': 'Parameters too long.',
  'Identifiant : lettres, chiffres et tirets seulement.': 'Identifier: letters, digits and dashes only.',
  'Cet identifiant est déjà utilisé.': 'This identifier is already used.',
  'Réglages de réflexion de {model}': 'Thinking settings of {model}',
  'Ce sont les choix proposés dans le panneau de l’assistant pour ce modèle, en plus d’« Auto » (réglage du fournisseur). Chaque choix ajoute ses paramètres à la requête envoyée au fournisseur.': 'These are the choices offered in the assistant panel for this model, in addition to “Auto” (the provider’s setting). Each choice adds its parameters to the request sent to the provider.',
  'Préréglage : les choix ci-dessous sont ceux de la documentation du fournisseur. Passez en « Personnalisé » pour les modifier.': 'Preset: the choices below come from the provider’s documentation. Switch to “Custom” to change them.',
  'Retirer ce réglage': 'Remove this setting',
  'Paramètres envoyés (JSON)': 'Parameters sent (JSON)',
  'Ajouter un réglage': 'Add a setting',
  'Sans réflexion': 'No thinking',
  'Avec réflexion': 'With thinking',
  'Très élevée': 'Very high',
  'Maximale': 'Maximum',

  // Journal des modifications
  'Assistant IA : dans Administration → IA, chaque modèle a ses réglages de réflexion, ceux que le panneau propose. Des préréglages sont fournis pour OpenAI, Qwen et DeepSeek V4.1 Flash, et « Personnalisé » permet d’écrire les siens (nom et paramètres envoyés au fournisseur).':
    'AI assistant: in Administration → AI, each model has its own thinking settings, the ones offered in the panel. Presets are provided for OpenAI, Qwen and DeepSeek V4.1 Flash, and “Custom” lets you write your own (name and parameters sent to the provider).',
  'Assistant IA : un préréglage de fournisseur « Qwen » (Alibaba Cloud Model Studio), et les réglages de réflexion de Qwen et de DeepSeek V4 sont reconnus d’après le nom du modèle.':
    'AI assistant: a “Qwen” provider preset (Alibaba Cloud Model Studio), and the thinking settings of Qwen and DeepSeek V4 are recognized from the model name.',
};
