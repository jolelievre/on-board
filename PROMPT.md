Salut,

je souhaite je joue beaucoup à des jeux de société, et j'en ai marre de noter sur du papier.
Je voudrais créer une appli qui me permette de noter les scores d'une partie, et qui sauvegarde l'historiques de mes parties. Le nombre de joueurs est différent d'un jeu à l'autre, et les personnes avec qui je jourrai aussi.

L'app doit tourner sur Android principalement, mais pourquoi pas aussi sur iPhone. Et je me dis qu'une app cross platform via web serait cool aussi. L'app peut garder les infos en local quand pas d'internet, mais peu synchroniser le tout une fois que la connexion revient. De sorte que quand je passe de ma tablette à mon portable j'ai toujorus accès aux mêmes historiques. La connexion se fera via google oauth pour commencer.

Chaque jeu a des règles et une façon de noter les scores différentes, et nécessitera donc des évolutions pour chaque jeu différent. POur commencer je souhaite gérer:
- 7 wonders Duel
- Skull King

Tu trouveras dans le dossier @assets des PDFs et images pour avoir une idée des règles et des grilles de score (pour au moins identifier la structure des scores).

Je soubaite que tu prépares un plan pour créer cette appli, dans les prmières phases nous pouvons faire un mini POC sur 7 wonders qui est plus simple à noter (un formulaire ressemblant à la grille de scores suffira pour démarrer). Skull king nécessitera plus d'effort niveau UX/design mais j'aimerais utiliser Claude Design (à titre expérimentale) pour cette partie là. De même l'UX et le style graphique seront définis via Claude design, donc fais en sorte dans la plannification que l'étape de design arrive assez vite avant de te lancer trop loin dans l'UX.

Il me semble aussi qu'un skill frontend-developer existe, peut-être que ça vaut le coup de l'intégrer à ce projet. Quels autres skills recommanderais-tu?

Sinon la page d'accueil sera une liste des jeux disponibles, une fois un jeu sélectionné on un un bouton pour démarer une partie, en dessous duquel on peut voir l'historique des parties jouées ou encours (pour celle pas encore finies).

Côté infra je dispose d'un VPN avec coolify dessus, mais il me semble que dans ta mémoire je t'avais déjà expliqué cette architecture. Si ce n'est pas le cas tu peux trouver un début d'info dans un autre projet /Users/jonathanlelievre/www/birthday-party/COOLIFY.md

Tu disposes d'un MCP pour accéder à mon coolify, normalement en lecture seule parce que je suis encore en apprentissage sur cet outil, donc je veux gérer la configuration moi-meme mais que tu puisses me guider et lire la configuration pour voir les soucis possibles.

Nous suivrons un workflow similaire au projet birthday-party:
- environnement intégration, deploy automatique quand on merge sur la branche main
- environnement production, déploiement via Github/release/tag
- environnement de test par PR, nous allons utiliser la fonctionnalité de pre-deployment de Coolify sur l'environnement d'integration mais avec une URL unique (qui ne prendre pas en compte la numéro de PR) vu que je ne test qu'une PR à la fois et que c'est plus simple de paramétrer une URL sur les applications google auth et autre)

Le projet devra intégrer dès le début des tests (unitaires pourquoi pas, mais sur E2E), je crois qu'il existe un skill claude pour ça non?

Je n'ai jamais fait d'app mobile, je ne sais pas comment déployer une app sur mon portable ou ma tabelette. Je ne suis pas sur de vouloir passer par l'App store ou la Play store parce que ce sera un usage personnel ou partagé à quelques amis probablement. Mais j'aimerais que l'installation soit assez simple, est-ce possible depuis us ite ou via un lien pour mes amis?

Il va aussi falloir qu'on réfléchisse dès le début à un nom pour cette appli pour initier le repo Github qui portera ce nom également.

As-tu compris le principe de cette app? Quels éléments devriaent être clarifiés d'après toi? Peux-tu me définir un plan pour démarrer le développement de cette app? Nous le persisterons dans le repo dans un fichier PLAN.md pour garder l'historique des étapes faites et qu'il reste à faire.
