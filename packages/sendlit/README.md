# SendLit TypeScript SDK

The official server-side TypeScript SDK for the [SendLit](https://sendlit.app)
API. Use it to sync contacts, run broadcasts and sequences, send
transactional email, and provision one SendLit team per tenant of your
platform.

Requests and responses are typed from the same contract the SendLit API
validates against, so the SDK can't drift from the server.

## Install

```bash
npm install sendlit
```

Requires Node.js 18 or later. The SDK is server-only and throws if it's
constructed in a browser. Never ship an API key to the client.

## Quickstart

```ts
import { SendLit } from "sendlit";

const sendlit = new SendLit({ apiKey: process.env.SENDLIT_API_KEY });

const contact = await sendlit.contacts.create({
    email: "ada@example.com",
    name: "Ada Lovelace",
    tags: ["signup"],
    customFields: { plan: "free" },
});

await sendlit.contacts.addTag(contact.contactId, "onboarding");
```

## Configuration

```ts
new SendLit({
    apiKey: "sl_live_…", // or set SENDLIT_API_KEY
    endpoint: "https://api.sendlit.app", // or SENDLIT_ENDPOINT; for self-hosting
    teamId: "team_…", // or SENDLIT_TEAM_ID
    maxRetries: 2,
    timeout: 30_000,
});
```

| Option        | Env var            | Notes                                                                                                                             |
| ------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `apiKey`      | `SENDLIT_API_KEY`  | A team key (`sl_live_…`) is sent as `x-sendlit-apikey`. An organization key (`sl_org_live_…`) is sent as `Authorization: Bearer`. |
| `accessToken` | —                  | An OAuth access token, sent as `Authorization: Bearer`. Use it instead of `apiKey`.                                               |
| `endpoint`    | `SENDLIT_ENDPOINT` | Defaults to `https://api.sendlit.app`.                                                                                            |
| `teamId`      | `SENDLIT_TEAM_ID`  | Sent as `x-sendlit-team-id`. Only needed when the credential can reach more than one team. A team key is bound to one team.       |
| `maxRetries`  | —                  | Default `2`. See [Retries](#retries).                                                                                             |
| `timeout`     | —                  | Per-attempt timeout in milliseconds. Default `30000`.                                                                             |
| `fetch`       | —                  | A custom `fetch` implementation.                                                                                                  |

## Resources

| Resource                 | Methods                                                                                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sendlit.contacts`       | `create`, `list`, `listAll`, `get`, `update`, `remove`, `addTag`, `removeTag`, `deliveries`                                                                          |
| `sendlit.segments`       | `create`, `list`, `get`, `update`, `remove`                                                                                                                          |
| `sendlit.templates`      | `list`, `listSystem`, `get`, `create`, `update`, `duplicate`, `remove`                                                                                               |
| `sendlit.sequences`      | Broadcasts and sequences: `create`, `list`, `listAll`, `get`, `update`, `remove`, `addEmail`, `updateEmail`, `removeEmail`, `start`, `pause`, `stats`, `subscribers` |
| `sendlit.emails`         | Transactional email: `send`, `get`, `list`, `listAll`                                                                                                                |
| `sendlit.provisioning`   | Organization key only: `provisionTeam`, `getTeam`, `updateTeam`, `createTeamKey`, `suspendTeam`, `resumeTeam`, `archiveTeam`, `getTeamUsage`                         |
| `sendlit.suppressions`   | `list`, `listAll`, `get`, `release`                                                                                                                                  |
| `sendlit.deliveryEvents` | `list`, `listAll`, `get`                                                                                                                                             |

Request and response types are exported too, for example `Contact`,
`CreateContactInput`, `Sequence`, and `SendEmailInput`.

### Contacts and onboarding sequences

`contacts.create` is find-or-create by email within the team:

- A **new** contact fires the `subscriber:added` event, which enrolls it in
  every active sequence with that trigger. This is how you start an
  onboarding sequence on signup.
- If the email **already exists**, the existing contact is returned unchanged
  and **no event fires**, so a repeat signup doesn't re-enroll the contact.
- Tags passed to `create` don't fire `tag:added`. Use `subscriber:added` as
  the onboarding trigger, or call `addTag` after creating the contact if you
  want a tag trigger.

### Pagination

`list` returns one page as `{ items, total }`. `listAll` returns an async
iterator that fetches pages as you go:

```ts
for await (const contact of sendlit.contacts.listAll({ q: "example.com" })) {
    console.log(contact.email);
}
```

## Errors

Every failed call rejects with a `SendLitError`:

```ts
import { SendLitError } from "sendlit";

try {
    await sendlit.contacts.get("con_missing");
} catch (error) {
    if (error instanceof SendLitError && error.status === 404) {
        // error.code is the API's `error` value, error.body the full response
    }
}
```

| Field     | Description                                                                                                                                  |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`  | The HTTP status, or `0` when no response was received.                                                                                       |
| `code`    | The API's `error` value. The SDK's own codes are `validation_error`, `connection_error`, `timeout`, `invalid_argument` and `invalid_config`. |
| `message` | A readable description.                                                                                                                      |
| `body`    | The parsed response body, including extra fields such as `missingVariables`.                                                                 |

IDs are validated before a request is sent. An empty or malformed ID rejects
with `invalid_argument` and never reaches the network.

## Retries

The SDK retries up to `maxRetries` times, with exponential backoff and
jitter. It honors `Retry-After` when the response includes one.

- **429** responses are retried for every call, because the request was
  rejected before any work was done.
- **5xx, timeouts, and network errors** are retried only for calls that are
  safe to repeat. That means `GET`, `PUT` and `DELETE` requests,
  `contacts.create` and `contacts.addTag` (both find-or-create),
  `provisioning.provisionTeam` (idempotent by `externalId`), and
  `emails.send` when you pass an `idempotencyKey`.

```ts
await sendlit.emails.send({
    to: "ada@example.com",
    subject: "Your receipt",
    templateId: "tpl_…",
    variables: { amount: "$10" },
    idempotencyKey: `receipt-${order.id}`,
});
```

## Platform example: one team per tenant

A multi-tenant platform such as CourseLit provisions one SendLit team for
each of its own tenants, then uses that team's key for everything else. See
[Provisioning teams](https://sendlit.app/developers/provisioning) for the
organization setup and key scopes.

```ts
import { SendLit } from "sendlit";

// 1. Provision the tenant's team with an organization key.
const platform = new SendLit({ apiKey: process.env.SENDLIT_ORG_API_KEY });

const team = await platform.provisioning.provisionTeam({
    externalId: school.id, // an immutable ID from your database
    name: school.name,
    mailingAddress: school.address,
});
if (team.created) {
    // The plaintext key is only returned once. Encrypt and store it now.
    await saveTeamKey(school.id, team.teamId, team.apiKey);
}

// 2. Act on that team with its own key.
const sendlit = new SendLit({ apiKey: await loadTeamKey(school.id) });

// Sync a signup. A new contact enters sequences triggered by subscriber:added.
await sendlit.contacts.create({
    email: user.email,
    name: user.name,
    customFields: { courselit_user_id: user.id },
});

// 3. Create and send a broadcast from a marketing template.
const templates = await sendlit.templates.list({ purpose: "marketing" });
let broadcast = await sendlit.sequences.create({
    type: "broadcast",
    templateId: templates[0].templateId,
});
broadcast = await sendlit.sequences.update(broadcast.sequenceId, {
    title: "October newsletter",
});
await sendlit.sequences.updateEmail(
    broadcast.sequenceId,
    broadcast.emails[0].emailId,
    {
        subject: "What's new in October",
        published: true,
        delayInMillis: Date.now(),
    },
);
await sendlit.sequences.start(broadcast.sequenceId);
```

Starting a broadcast or sequence requires a mailing address in the team's
settings (set it with `mailingAddress` when provisioning) and a way to send
email: either an organization delivery grant or the team's own ESP.

## License

MIT
