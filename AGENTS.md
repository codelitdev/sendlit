## Development Tips

- Don't duplicate stuff over and over. Re-use existing code and libraries.
- While making changes to the `apps/api` directory, make sure the REST API documentation and MCP server are updated as well.
- For UI components, use shadcn/ui exclusively. Always use Shadcn CLI for installing components. Never hand roll standard Shadcn components. Prefer shadcn/ui components over browser-native components.

## Architecture Tips

- Always lean towards industry standards in the bulk emailing services domain while working on features. You can consider Mailchimp, Klaviyo, SendGrid, ActiveCampaign, or other popular email marketing platforms.

## Branch management

- Never push on your own. Leave it to the human.

## Testing Tips

- From browser based smoke testing, boot up the API and Web app using `pnpm dev:api` and `pnpm dev:web` respectively.
- The following docker containers need to be running: `postgres`, `redis`, `mailpit` for full integration testing.
- Prefer Chrome DevTools MCP for browser-based debugging, in the headful mode.
