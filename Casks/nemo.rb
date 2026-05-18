cask "nemo" do
  version :latest
  sha256 :no_check

  url "https://github.com/omarestrella/nemo/releases/latest/download/Nemo.zip"
  name "Nemo"
  desc "Menu bar utility for monitoring Dokku apps through a paired sidecar"
  homepage "https://github.com/omarestrella/nemo"

  app "Nemo.app"

  uninstall quit: "net.bitcreative.Nemo"

  zap trash: [
    "~/Library/Caches/net.bitcreative.Nemo",
    "~/Library/Preferences/net.bitcreative.Nemo.plist",
  ]

  caveats <<~EOS
    Install the Dokku host agent with:
      curl -fsSL https://raw.githubusercontent.com/omarestrella/nemo/main/install.sh | sh
  EOS
end
