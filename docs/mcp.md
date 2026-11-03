# House Finder e assistenti MCP

Il runtime AI interno e il collegamento MCP sono indipendenti. Il primo esegue
i task dell’app tramite la connessione scelta. Il MCP permette invece al tuo
assistente di consultare House Finder e proporre operazioni nell’app aperta.

## Collegamento personale

1. Apri House Finder e vai a Config → Connessioni AI → MCP e proposte.
2. Premi **Prepara collegamento MCP**. Questa azione crea il token privato locale.
3. Usa il comando e gli argomenti generati nel client. La configurazione include
   il percorso del file token, mai il suo contenuto.
4. Mantieni House Finder aperto. Il proxy non avvia l’app, non apre un secondo
   archivio e non usa il daemon Codex della tua sessione di sviluppo.

L’entry Codex si chiama `housefinder`. Una registrazione personale nella
configurazione utente la rende disponibile anche da altre cartelle; una
registrazione soltanto nella repository non ha questo effetto. La generazione
non modifica alcuna configurazione globale e non sovrascrive `jobfinder` o altri
server. Ogni utente configura il proprio collegamento; nessun account o token
personale è distribuito nel pacchetto.

Il trasporto STDIO è avviato dal client con `node scripts/mcp.js --url <origine>
--token-file <file-privato>`. In sviluppo viene generato il percorso assoluto
del loader TypeScript. È disponibile anche Streamable HTTP su `/mcp`, sempre
su loopback e con Bearer token. Non pubblicare il token o un tunnel del servizio.
La compatibilità con client desktop specifici richiede prove su quei client.

## Operazioni disponibili

Gli strumenti leggono salute, annunci filtrati/paginati, dettaglio annuncio,
statistiche, profilo, stato scansione e stato operazione. Possono impostare uno
stato reversibile con `requestId` oppure proporre un profilo e una scansione.
Il profilo è proposto per intero: leggi prima quello corrente per conservarne
le preferenze. Non esistono strumenti per reset, file arbitrari, credenziali,
invio di messaggi, approvazioni o accesso alla posta.

Le proposte non modificano il profilo né avviano ricerche. Solo l’utente nella
UI può confermare o rifiutare. Una scansione confermata dal MCP raccoglie e
deduplica senza AI, senza invii di notifiche; continua a rispettare le regole
del canale email su persistenza e Seen. Il token MCP non è una sessione UI:
conferme e configurazioni richiedono cookie browser, origine corretta e CSRF.

Le scritture usano un `requestId` stabile: ripetere lo stesso input restituisce
lo stesso risultato; riutilizzarlo per altro input dà conflitto. Dopo un crash
un’operazione incerta non viene ripetuta automaticamente. Controlla lo stato
effettivo nell’app. Le mutazioni degli annunci restano bloccate durante run o
aggiornamenti; criteri cambiati rendono una vecchia proposta non applicabile.

I dati privati rimangono nei percorsi esistenti. La capability è in
`state/agent/mcp-token.txt`, il diario in `state/agent/operations.json` (usando
la directory stato effettiva). Conserva entrambe nel backup privato, mai in Git
o negli ZIP. Le descrizioni degli annunci sono dati non attendibili, non
istruzioni per l’assistente. I tool non richiamano un altro modello.

## Collaudo ripetibile

`npx tsx scripts/try-mcp.ts` avvia un’app con un solo annuncio inventato, su una
porta temporanea, e un vero `codex exec` da un’altra cartella. Consuma una
richiesta dell’account Codex selezionato. Prima verifica autenticazione nativa e
inventario dei tool; abilita soltanto il server fixture negli override del
processo, senza cambiare la configurazione globale. Il client consulta i dati,
imposta e ripristina uno stato, propone una scansione; il collaudo conferma poi
la proposta tramite una sessione UI isolata. Nessun portale o casella reale è
usato, nessun modello viene richiamato dai tool. La capability temporanea viene
rimossa; il report non contiene token.

Per verificare soltanto protocollo, account e inventario, senza inferenza:

```powershell
$env:HOUSE_MCP_DIAGNOSTIC = '1'
npx tsx scripts/try-mcp.ts
Remove-Item Env:\HOUSE_MCP_DIAGNOSTIC
```

Il runtime di completamento interno rimane senza strumenti. Il client MCP
esterno mantiene invece attivo il supporto necessario ai tool, sempre limitato
alla fixture durante il collaudo.
