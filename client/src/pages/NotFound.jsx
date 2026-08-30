import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { EmptyState } from '../components/ui/primitives.jsx';

export function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <EmptyState
        icon={Compass}
        title="That page does not exist"
        description="The link may be out of date, or the record may have been archived."
        action={<Link to="/" className="text-sm font-medium text-brand hover:underline">Back to the overview</Link>}
      />
    </div>
  );
}

export function Forbidden() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <EmptyState
        icon={Compass}
        title="Your role does not include this"
        description="Ask an administrator to widen your access if you need it."
        action={<Link to="/" className="text-sm font-medium text-brand hover:underline">Back to the overview</Link>}
      />
    </div>
  );
}
