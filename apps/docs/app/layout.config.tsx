import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import Image from "next/image";

export const baseOptions: BaseLayoutProps = {
  nav: {
    title: (
      <>
        <Image src="/icon.svg" alt="SendLit logo" width={24} height={24} />
        SendLit Docs
      </>
    ),
  },
  githubUrl: "https://github.com/codelitdev/sendlit",
};
