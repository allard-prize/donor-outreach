import { createProspect } from "../actions";
import { ProspectForm } from "../prospect-form";

export default function NewProspectPage() {
  return (
    <main>
      <h1 className="text-xl font-semibold">Add prospect</h1>
      <ProspectForm action={createProspect} submitLabel="Create prospect" />
    </main>
  );
}
