import ClientRoot from "@/components/ClientRoot";
import { checkCatalog } from "@/engine/integrity";
import { loadCatalog } from "@/engine/load";

// Read /data on every request, so edits to facts and rules show up on refresh.
export const dynamic = "force-dynamic";

export default function Page() {
  const catalog = loadCatalog();
  return <ClientRoot catalog={catalog} problems={checkCatalog(catalog)} />;
}
