# Quality Events / Evidence Records

Ce socle ajoute deux registres transversaux sans modifier les flux metier existants.

## Tables

`quality_events` enregistre un evenement metier qualite idempotent par magasin. La cle d idempotence active est:

`store_id + event_type + source_table + source_id + source_line_id + source_discriminator`

`source_line_id` et `source_discriminator` permettent de distinguer une ligne, un lot, un poste ou une variante de source lorsque le meme document metier doit produire plusieurs evenements qualite.

`quality_evidence_records` enregistre les preuves qualite. Une preuve peut etre liee a `quality_events.id`, ou etre saisie directement par un humain sans evenement metier lorsque le controle n est pas declenche par une source operationnelle.

Pour les preuves automatiques liees a un evenement, l idempotence active est:

`store_id + quality_event_id + evidence_type + source_record_type + source_record_id + source_discriminator`

Cette cle permet a un meme evenement de produire plusieurs preuves legitimes de types differents, par exemple `reception_record` et `traceability_snapshot`, tout en empechant un retry technique de recreer deux fois la meme preuve automatique. `source_discriminator` distingue une ligne, un lot, une photo, une section ou un autre sous-objet quand la meme source doit produire plusieurs preuves du meme type.

Les preuves humaines (`source_type = human`) ne sont pas dedupliquees par cette cle: plusieurs saisies humaines du meme type peuvent etre legitimes.

## Flux

Flux automatique:

`business event -> quality_events -> 0..n quality_evidence_records`

Flux controle humain direct:

`direct human control -> quality_evidence_records`

Les preuves restent un registre de reference. Elles ne remplacent pas les modules temperature, nettoyage, non-conformites, documents ou photos; elles les relient lorsque c est utile via les colonnes optionnelles.

## Isolation transactionnelle

Les services `createOrGetQualityEvent`, `getQualityEventById`, `createOrGetQualityEvidenceRecord`, `createQualityEvidenceRecord` et `listEvidenceForEvent` recoivent toujours un client/pool `db` existant. Ils n ouvrent pas de connexion autonome. Appeles avec un client transactionnel, l evenement et ses preuves sont donc valides ou annules ensemble par la transaction appelante.

`createOrGetQualityEvidenceRecord` retourne `{ evidence, created }`. Pour les preuves automatiques liees a un evenement, `created` vaut `false` lors d un rejeu exact. Pour les preuves humaines directes, chaque appel cree une nouvelle preuve.

## Integrite magasin

La FK composite `(quality_event_id, store_id) -> quality_events(id, store_id)` empeche de rattacher une preuve d un magasin A a un evenement d un magasin B. Le service verifie aussi ce cas avant insertion pour retourner une erreur explicite.

Les references optionnelles `quality_task_id`, `occurrence_id`, `non_conformity_id`, `document_id`, `photo_id` et `master_document_id` sont validees par le service avec une recherche `id + store_id` avant insertion. Ce choix evite d ajouter des contraintes composites redondantes aux tables qualite historiques qui ont deja `id` en cle primaire et `store_id` en colonne d isolation.
