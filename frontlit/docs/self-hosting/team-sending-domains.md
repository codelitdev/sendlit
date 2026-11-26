---
title: Teams' own sending domains (Amazon SES)
description: Create the AWS IAM key that lets SendLit register each team's own sending domain on a shared Amazon SES mailbox.
nav_order: 25
---

On a shared Amazon SES mailbox, each team can send from its own domain, so
inboxes judge its mail on its own reputation instead of the mailbox's (see
[Organizations](/docs/workspace/organizations)). SendLit registers each team's
domain in your SES account for you, which needs an AWS API key on the
mailbox. The SMTP password can only send, so this is a separate key.

The key belongs to the organization: an owner or admin stores it on the
shared mailbox, encrypted, and it's never shown again. Nothing goes in
SendLit's own configuration.

## Create the IAM policy

In the AWS console, open **IAM → Policies → Create policy**, choose the
**JSON** tab, and paste this, with your AWS account ID:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SendLitTeamSendingDomains",
      "Effect": "Allow",
      "Action": [
        "ses:CreateEmailIdentity",
        "ses:GetEmailIdentity",
        "ses:DeleteEmailIdentity"
      ],
      "Resource": "arn:aws:ses:*:YOUR_ACCOUNT_ID:identity/*"
    }
  ]
}
```

Name it `sendlit-team-sending-domains` and create it. These three actions
register a domain with Easy DKIM, check whether SES has verified it, and
remove it when a team stops using it. The key can't send email or change
anything else in your account. The console may note that SES v2 actions also
cover the older Pinpoint Email API; that's expected.

## Create the user and access key

1. **IAM → Users → Create user.** Name it, for example,
   `sendlit-team-domains`. Leave console access off.
2. Choose **Attach policies directly**, select `sendlit-team-sending-domains`,
   and create the user.
3. Open the user, then **Security credentials → Access keys → Create access
   key**. Choose **Application running outside AWS**.
4. Copy the **Access key ID** and **Secret access key**. AWS shows the secret
   only once.

## Store it on the shared mailbox

In SendLit, open **Organizations → Delivery**, the Amazon SES mailbox's
actions, then **Amazon SES API key**. Paste the key ID and secret, and enter
the **region** your SES account sends from (the one in the SMTP host, for
example `ap-southeast-1` for `email-smtp.ap-southeast-1.amazonaws.com`).
Domain identities are per region, so it must match. SendLit checks the key
with one SES lookup before saving it. The key can't be removed while teams'
domains are registered through it, since SendLit needs it to check and
remove them.

Over the API, an organization key with `esps:manage` can store it instead:

```bash
curl --request PUT \
  "$SENDLIT_API_URL/organizations/org_01JXYZ/esps/esp_01JXYZ/management-credentials" \
  --header "Authorization: Bearer $SENDLIT_ORGANIZATION_API_KEY" \
  --header 'Content-Type: application/json' \
  --data '{ "accessKeyId": "AKIA…", "secretAccessKey": "…", "region": "ap-southeast-1" }'
```

Then give a team its domain from **Organizations → Teams → Sending domain**,
or with `PUT /provisioning/teams/:teamId/sending-domain`
([Provisioning](/docs/developers/provisioning)).

## Settings

| Variable | Default | What it does |
| --- | --- | --- |
| `TEAM_SENDING_DOMAIN_GRACE_HOURS` | `72` | How long a team keeps sending from its domain after DKIM or DMARC stop passing, before its broadcasts and sequences pause. |

SendLit re-checks every team domain hourly. To rotate the key, create a new
one, store it the same way, then delete the old one in IAM. Removing the key
from the mailbox stops new team domains from being registered; domains that
are already verified keep working.
