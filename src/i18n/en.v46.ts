/** Textes ajoutés en 2.23 : recherche sémantique (RAG) de l’assistant IA. */
export const enV46: Record<string, string> = {
  'Réglages de la recherche sémantique indisponibles':
    'Semantic search settings unavailable',
  'Automatique (d’après le modèle : {preset})':
    'Automatic (from the model: {preset})',
  'Aucune mise en forme':
    'No formatting',
  'Personnalisée':
    'Custom',
  'Recherche sémantique activée':
    'Semantic search enabled',
  'Essai impossible':
    'Test failed',
  'Aucun modèle proposé par ce serveur':
    'This server offers no model',
  'Modèles introuvables':
    'Models not found',
  'Indexation impossible':
    'Indexing impossible',
  '{n} projet|{n} projets':
    '{n} project|{n} projects',
  '{n} espace de documentation|{n} espaces de documentation':
    '{n} documentation space|{n} documentation spaces',
  '{n} espace de tableaux|{n} espaces de tableaux':
    '{n} whiteboard space|{n} whiteboard spaces',
  'Recherche sémantique (RAG)':
    'Semantic search (RAG)',
  'Un modèle d’embeddings compatible OpenAI (Ollama, LM Studio, vLLM, OpenAI…) indexe les tickets, notes et tableaux des projets et espaces qui l’activent dans leurs réglages (désactivé par défaut). L’assistant IA y cherche alors par le sens, toujours dans les seuls projets et espaces de la personne qui pose la question.':
    'An OpenAI-compatible embedding model (Ollama, LM Studio, vLLM, OpenAI…) indexes the tickets, notes and boards of the projects and spaces that turn it on in their settings (off by default). The AI assistant then searches them by meaning, always only in the projects and spaces of the person asking.',
  'Recherche sémantique désactivée':
    'Semantic search disabled',
  'Adresse du serveur d’embeddings':
    'Embedding server address',
  'Compatible OpenAI v1 : le serveur reçoit POST …/embeddings. Pour Ollama : http://localhost:11434/v1.':
    'OpenAI v1 compatible: the server receives POST …/embeddings. For Ollama: http://localhost:11434/v1.',
  'Par exemple embeddinggemma, nomic-embed-text ou qwen3-embedding:0.6b.':
    'For example embeddinggemma, nomic-embed-text or qwen3-embedding:0.6b.',
  'Vide : la clé sera effacée':
    'Empty: the key will be erased',
  'Facultative (serveur local)':
    'Optional (local server)',
  'Garder la clé enregistrée':
    'Keep the saved key',
  'Format des requêtes':
    'Request format',
  'Les modèles récents attendent une consigne pour la question et une autre pour les passages ; sans elle, la recherche perd en qualité sans erreur.':
    'Recent models expect one instruction for the question and another for the passages; without it, search quality drops without any error.',
  'Gabarit d’une question':
    'Question template',
  'Gabarit d’un passage':
    'Passage template',
  '{text} : le texte ; {title} : le titre du passage (note, ticket, tableau).':
    '{text}: the text; {title}: the title of the passage (note, ticket, board).',
  'Question':
    'Question',
  'Passage':
    'Passage',
  'Réindexer automatiquement toutes les':
    'Reindex automatically every',
  'Unité':
    'Unit',
  'Seul ce qui a changé est recalculé ; un projet ou un espace activé est indexé aussitôt.':
    'Only what changed is recomputed; a project or space that turns it on is indexed right away.',
  'Taille des vecteurs (facultatif)':
    'Vector size (optional)',
  'Celle du modèle':
    'The model’s',
  'Tronque les vecteurs pour un index plus léger (EmbeddingGemma : 768, 512, 256 ou 128).':
    'Truncates the vectors for a lighter index (EmbeddingGemma: 768, 512, 256 or 128).',
  'Taille des passages (caractères)':
    'Passage size (characters)',
  'Délai de réponse (secondes)':
    'Response timeout (seconds)',
  'Embeddings reçus : {dims} dimensions en {ms} ms ({format}).':
    'Embeddings received: {dims} dimensions in {ms} ms ({format}).',
  'La question d’essai est plus proche du passage qui y répond ({related}) que d’un passage sans rapport ({unrelated}).':
    'The test question is closer to the passage that answers it ({related}) than to an unrelated passage ({unrelated}).',
  'Mais la question d’essai n’est pas plus proche du passage qui y répond ({related} contre {unrelated}) : vérifiez le modèle et le format des requêtes.':
    'But the test question is not closer to the passage that answers it ({related} versus {unrelated}): check the model and the request format.',
  'Index':
    'Index',
  'Indexer maintenant':
    'Index now',
  'Tout reconstruire':
    'Rebuild everything',
  'Indexation : {done} sur {total}':
    'Indexing: {done} of {total}',
  'Indexation…':
    'Indexing…',
  'Le modèle ou son format a changé : l’index sera reconstruit à la prochaine indexation.':
    'The model or its format changed: the index will be rebuilt at the next indexing.',
  '{n} passage|{n} passages':
    '{n} passage|{n} passages',
  'Aucun projet ni espace ne l’a encore activé : chacun l’active dans ses réglages (projet : Réglages → Général ; espace : Modifier l’espace).':
    'No project or space has turned it on yet: each one does so in its settings (project: Settings → General; space: Edit space).',
  'Dernière indexation réussie {when}':
    'Last successful indexing {when}',
  '{s} s':
    '{s} s',
  'Jamais indexé':
    'Never indexed',
  '{n} dimensions':
    '{n} dimensions',
  'prochaine : {when}':
    'next: {when}',
  'les tableaux de cet espace':
    'the boards of this space',
  'Recherche sémantique (RAG) pour l’assistant IA':
    'Semantic search (RAG) for the AI assistant',
  'Indexe {what} pour que l’assistant les retrouve par le sens, même formulés autrement. Seules les personnes qui y ont accès en voient les passages. Désactivé par défaut.':
    'Indexes {what} so that the assistant finds them by meaning, even when worded differently. Only people who have access see their passages. Off by default.',
  'les notes de cet espace':
    'the notes of this space',
  'Recherche sémantique activée pour ce projet':
    'Semantic search enabled for this project',
  'Recherche sémantique désactivée pour ce projet':
    'Semantic search disabled for this project',
  'Ses tickets seront indexés dans quelques instants.':
    'Its tickets will be indexed in a few moments.',
  'les tickets de ce projet (titre, description, avancement, commentaires)':
    'the tickets of this project (title, description, progress, comments)',
  'Recherche sémantique (RAG) pour l’assistant IA : dans Administration → IA, on branche un modèle d’embeddings compatible OpenAI (Ollama, LM Studio…) avec le bon format pour EmbeddingGemma, Nomic Embed ou Qwen3 Embedding, un bouton « Tester » et une réindexation automatique toutes les X heures ou jours. Chaque projet, espace de documentation et espace de tableaux l’active dans ses réglages (désactivé par défaut) ; l’assistant y cherche alors par le sens, dans les seuls projets et espaces de la personne qui pose la question, et cite les passages trouvés.':
    'Semantic search (RAG) for the AI assistant: in Administration → AI, you connect an OpenAI-compatible embedding model (Ollama, LM Studio…) with the right format for EmbeddingGemma, Nomic Embed or Qwen3 Embedding, a “Test” button and automatic reindexing every X hours or days. Each project, documentation space and whiteboard space turns it on in its settings (off by default); the assistant then searches them by meaning, only in the projects and spaces of the person asking, and cites the passages it finds.',
};
