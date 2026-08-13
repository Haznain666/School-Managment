'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { GENDERS } from '@/db/schema/student-profiles';
import {
  GUARDIAN_RELATIONSHIPS,
  GUARDIAN_RELATIONSHIP_LABELS,
  type GuardianRelationship,
} from '@/db/schema/student-guardians';
import { createCaptchaChallenge } from '@/lib/admissions-captcha';
import { isValidPhone } from '@/lib/phone';
import { schoolErrorMessage, schoolFetch, withSchoolParam } from '@/lib/school-client';

/**
 * The public application form.
 *
 * Everything here is typed by someone who has no account and never will unless
 * their child is admitted, so the form asks for the least it can: enough to
 * identify the child, and a number the school can reply on. The arithmetic
 * question is a spam filter, not a security control — see
 * `lib/admissions-captcha.ts`.
 */

export interface ApplyBranch {
  id: string;
  name: string;
}

export interface ApplyGrade {
  id: string;
  branchId: string;
  label: string;
}

export interface ApplyFormProps {
  branches: readonly ApplyBranch[];
  grades: readonly ApplyGrade[];
}

const GENDER_OPTIONS = GENDERS.map((value) => ({
  value,
  label: value.charAt(0).toUpperCase() + value.slice(1),
}));

const RELATIONSHIP_OPTIONS = GUARDIAN_RELATIONSHIPS.map((value) => ({
  value,
  label: GUARDIAN_RELATIONSHIP_LABELS[value],
}));

export function ApplyForm({ branches, grades }: ApplyFormProps) {
  const router = useRouter();

  const [studentName, setStudentName] = useState('');
  const [studentDob, setStudentDob] = useState('');
  const [studentGender, setStudentGender] = useState('');
  const [previousSchool, setPreviousSchool] = useState('');
  const [medicalNotes, setMedicalNotes] = useState('');

  const [guardianName, setGuardianName] = useState('');
  const [guardianRelationship, setGuardianRelationship] =
    useState<GuardianRelationship>('father');
  const [guardianPhone, setGuardianPhone] = useState('');
  const [guardianEmail, setGuardianEmail] = useState('');
  const [guardianCnic, setGuardianCnic] = useState('');

  const [branchId, setBranchId] = useState(branches.length === 1 ? (branches[0]?.id ?? '') : '');
  const [gradeId, setGradeId] = useState('');
  const [notes, setNotes] = useState('');

  // Generated once per mount: regenerating on every keystroke would reset the
  // question under the applicant while they are answering it.
  const [captcha] = useState(() => createCaptchaChallenge());
  const [captchaAnswer, setCaptchaAnswer] = useState('');

  const [duplicateStatus, setDuplicateStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const gradeOptions = useMemo(
    () =>
      grades
        .filter((grade) => branchId === '' || grade.branchId === branchId)
        .map((grade) => ({ value: grade.id, label: grade.label })),
    [grades, branchId],
  );

  // Warns about an application already in flight for this number. Advisory
  // only — a family with two children applying is a normal thing to do.
  useEffect(() => {
    if (!isValidPhone(guardianPhone)) {
      setDuplicateStatus(null);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      void schoolFetch<{ exists: boolean; status?: string }>(
        `/api/admissions/check?phone=${encodeURIComponent(guardianPhone)}`,
        { signal: controller.signal },
      )
        .then((result) => {
          setDuplicateStatus(result.exists ? (result.status ?? 'pending') : null);
        })
        .catch(() => {
          setDuplicateStatus(null);
        });
    }, 500);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [guardianPhone]);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    if (studentName.trim() === '') {
      setError('Enter the student’s full name.');
      return;
    }
    if (studentDob === '') {
      setError('Enter the student’s date of birth.');
      return;
    }
    if (studentGender === '') {
      setError('Select the student’s gender.');
      return;
    }
    if (guardianName.trim() === '') {
      setError('Enter your full name.');
      return;
    }
    if (!isValidPhone(guardianPhone)) {
      setError('Enter a valid Pakistani mobile number, for example 0300-1234567.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const result = await schoolFetch<{ applicationId: string; studentName: string }>(
        '/api/admissions/apply',
        {
          method: 'POST',
          body: JSON.stringify({
            studentName,
            studentDob,
            studentGender,
            previousSchool,
            medicalNotes,
            guardianName,
            guardianRelationship,
            guardianPhone,
            guardianEmail,
            guardianCnic,
            branchId: branchId === '' ? null : branchId,
            gradeId: gradeId === '' ? null : gradeId,
            notes,
            captchaQuestion: captcha.question,
            captchaAnswer,
          }),
        },
      );

      const query = new URLSearchParams({
        ref: result.applicationId,
        student: studentName,
        guardian: guardianName,
        phone: guardianPhone,
      });

      router.push(withSchoolParam(`/apply/success?${query.toString()}`));
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not submit your application.'));
      setIsSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        void submit(event);
      }}
      className="space-y-6"
      noValidate
    >
      <Card header={<CardTitle title="Student" />}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Input
              label="Student's full name"
              required
              value={studentName}
              disabled={isSubmitting}
              onChange={(event) => {
                setStudentName(event.target.value);
              }}
            />
          </div>

          <Input
            label="Date of birth"
            type="date"
            required
            value={studentDob}
            disabled={isSubmitting}
            onChange={(event) => {
              setStudentDob(event.target.value);
            }}
          />

          <Select
            label="Gender"
            required
            placeholder="Select"
            options={GENDER_OPTIONS}
            value={studentGender}
            disabled={isSubmitting}
            onChange={(event) => {
              setStudentGender(event.target.value);
            }}
          />

          <div className="sm:col-span-2">
            <Input
              label="Previous school"
              hint="Optional."
              value={previousSchool}
              disabled={isSubmitting}
              onChange={(event) => {
                setPreviousSchool(event.target.value);
              }}
            />
          </div>

          <div className="sm:col-span-2">
            <Textarea
              label="Medical notes"
              hint="Optional. Allergies, conditions or medication we should know about."
              value={medicalNotes}
              disabled={isSubmitting}
              onChange={(event) => {
                setMedicalNotes(event.target.value);
              }}
            />
          </div>
        </div>
      </Card>

      <Card header={<CardTitle title="Parent or guardian" />}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Your full name"
            required
            value={guardianName}
            disabled={isSubmitting}
            onChange={(event) => {
              setGuardianName(event.target.value);
            }}
          />

          <Select
            label="Relationship to student"
            required
            options={RELATIONSHIP_OPTIONS}
            value={guardianRelationship}
            disabled={isSubmitting}
            onChange={(event) => {
              setGuardianRelationship(event.target.value as GuardianRelationship);
            }}
          />

          <Input
            label="Phone number"
            type="tel"
            required
            placeholder="0300-1234567"
            hint="We will contact you on WhatsApp about this application."
            value={guardianPhone}
            disabled={isSubmitting}
            onChange={(event) => {
              setGuardianPhone(event.target.value);
            }}
          />

          <Input
            label="Email"
            type="email"
            hint="Optional, but it gives us a second way to reach you."
            value={guardianEmail}
            disabled={isSubmitting}
            onChange={(event) => {
              setGuardianEmail(event.target.value);
            }}
          />

          <div className="sm:col-span-2">
            <Input
              label="CNIC"
              hint="Optional."
              placeholder="42101-1234567-1"
              value={guardianCnic}
              disabled={isSubmitting}
              onChange={(event) => {
                setGuardianCnic(event.target.value);
              }}
            />
          </div>

          {duplicateStatus !== null ? (
            <p className="rounded-lg bg-status-warning-subtle px-3 py-2 text-sm text-status-warning-onSubtle sm:col-span-2">
              We already have an application from this number, currently{' '}
              {duplicateStatus}. You can still submit another one if you are
              applying for a second child.
            </p>
          ) : null}
        </div>
      </Card>

      <Card header={<CardTitle title="Applying for" />}>
        <div className="grid gap-4 sm:grid-cols-2">
          {branches.length > 1 ? (
            <Select
              label="Preferred campus"
              placeholder="Select a campus"
              options={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
              value={branchId}
              disabled={isSubmitting}
              onChange={(event) => {
                setBranchId(event.target.value);
                setGradeId('');
              }}
            />
          ) : null}

          <Select
            label="Grade"
            placeholder={
              gradeOptions.length === 0 ? 'No grades listed' : 'Select a grade'
            }
            options={gradeOptions}
            value={gradeId}
            disabled={isSubmitting || gradeOptions.length === 0}
            onChange={(event) => {
              setGradeId(event.target.value);
            }}
          />

          <div className="sm:col-span-2">
            <Textarea
              label="Anything else we should know"
              hint="Optional."
              value={notes}
              disabled={isSubmitting}
              onChange={(event) => {
                setNotes(event.target.value);
              }}
            />
          </div>
        </div>
      </Card>

      <Card>
        <Input
          label={captcha.question}
          required
          inputMode="numeric"
          hint="A quick check that you are not a robot."
          value={captchaAnswer}
          disabled={isSubmitting}
          onChange={(event) => {
            setCaptchaAnswer(event.target.value);
          }}
        />
      </Card>

      {error !== null ? (
        <p role="alert" className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}

      <Button type="submit" size="lg" fullWidth isLoading={isSubmitting}>
        Submit application
      </Button>
    </form>
  );
}
