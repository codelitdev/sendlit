---
"sendlit": minor
"@sendlit/email-blocks": minor
---

A broadcast or sequence has a `viewInBrowser` setting. It is on for broadcasts and off for sequences created from now on; existing sequences keep it on. Turning it off sends its emails without the "View in browser" link and takes down the hosted web versions behind links already sent. `@sendlit/email-blocks` adds `viewInBrowser` to its sequence type.
