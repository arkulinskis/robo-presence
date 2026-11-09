"""The app starts here (anvil.yaml: startup module). One server call to learn who is signed in (Anvil's loading
spinner shows meanwhile), the Privacy & Terms kit, the bridge the JavaScript engines use (rp.setup), then the page for
the address in the browser bar."""
import anvil.server

from . import legal, router, rp, state

LEGAL_THEME = {"accent": "#c4521a"}  # colours for the Privacy & Terms page (the JavaScript version's value)

legal.setup(LEGAL_THEME)
rp.setup()
state.set_me(anvil.server.call("get_me"))
if state.me():
    legal.refresh_soon()
router.start()
