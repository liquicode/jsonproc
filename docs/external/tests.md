# @liquicode/jsonproc

> Version: 0.1.0

# Test Results

## Unit Tests

```
100) Process Runtime Tests
    Starting a Run
      ✔ should begin ready, at the first step
      ✔ should carry the name of the process it belongs to
      ✔ should stamp null for a process with no name
      ✔ should clone the input rather than work on it
      ✔ should take no input as an empty state
      ✔ should carry a scope holding the instant the run began
      ✔ should fail a process which is not a document with Steps
      ✔ should fail an input which is not a document
    The $do Step
      ✔ should compute a field from the state
      ✔ should store a literal
      ✔ should remove a field whose expression produces nothing
      ✔ should evaluate every field against the state as it was at the top of the step
      ✔ should see the variables the run carries
      ✔ should advance to the next step
      ✔ should refuse an argument which is not a document
    The $when Step
      ✔ should enter the Then branch when the check matches
      ✔ should enter the Else branch when the check does not match
      ✔ should push the branch onto the cursor
      ✔ should advance past the step when a false check has no Else
      ✔ should advance past a branch which is present but empty
      ✔ should leave a branch and carry on with the step after it
      ✔ should nest, and unwind two levels at once
      ✔ should take a query holding $expr
      ✔ should refuse a Check which is not a query document
    The $while Step
      ✔ should run the body until the check stops matching
      ✔ should run the body no times at all when the check is false to begin with
      ✔ should push the body onto the cursor
      ✔ should return to the loop step when the body ends, rather than past it
      ✔ should carry on with the step after the loop once the check fails
      ✔ should refuse an empty body as a bad process
      ✔ should refuse a missing body as a bad process
      ✔ should refuse a missing check as a bad process
      ✔ should be stopped by the step budget when the check never fails (9ms)
      ✔ should be stopped at the budget the caller named
      ✔ should never be stopped by a budget when stepped one step at a time
    The $forEach Step
      ✔ should run the body once for each element
      ✔ should write each element to the field named by As
      ✔ should write the position to the field named by Index
      ✔ should remove As and Index from the state when the loop ends
      ✔ should leave the state alone when the array is empty
      ✔ should keep the iteration in the cursor
      ✔ should start at the first element even when the input already carries the Index field
      ✔ should run a loop inside a loop
      ✔ should run a branch inside a loop
      ✔ should suspend inside a pass and resume into the next one
      ✔ should carry a run suspended in the middle of a pass through storage
      ✔ should see an array the body has added to
      ✔ should fail when In does not produce an array
      ✔ should refuse a missing As as a bad process
      ✔ should refuse an empty body as a bad process
      ✔ should refuse an Index which is not a field name as a bad process
    The $throw Step
      ✔ should halt the run when nothing catches it
      ✔ should call a thrown string Thrown
      ✔ should take a Code and a Message from a thrown document
      ✔ should evaluate the message as an expression
      ✔ should name the cursor it was thrown at
      ✔ should refuse a reserved code as a bad process
      ✔ should refuse a reserved code even inside a try
    The $try Step
      ✔ should run the Catch branch when a step fails
      ✔ should write the error to the field named by As
      ✔ should let a $when in the handler test the code
      ✔ should carry on with the step after the try
      ✔ should not run the Catch branch when the body succeeds
      ✔ should show the handler the state as the failure left it
      ✔ should catch an operator which refused
      ✔ should catch a call the host reported as failed
      ✔ should catch a failure reported to a run which was stored while waiting
      ✔ should take no As at all
      ✔ should not catch a failure raised inside its own Catch
      ✔ should let the try around it catch a failure raised inside a Catch
      ✔ should catch a failure raised inside a loop in its body
      ✔ should leave an abandoned loop's As field on the state
      ✔ should catch on every pass of a loop it sits inside
    What a $try Does Not Catch
      ✔ should not catch an operator which is not registered
      ✔ should not catch a fault in the process document
      ✔ should not catch a step which is not a document with one key
      ✔ should not catch the step budget running out
    Arguments the $try Step Refuses
      ✔ should refuse a missing Do
      ✔ should refuse an empty Do
      ✔ should refuse a missing Catch
      ✔ should refuse an empty Catch
      ✔ should refuse an As which is not a field name
    The $call Step
      ✔ should suspend rather than call
      ✔ should evaluate With against the state
      ✔ should carry Into when there is one, and leave it off when there is not
      ✔ should leave the cursor on the call until it is resumed
      ✔ should take no With as an empty With
      ✔ should refuse a call with no Name
    The $return Step
      ✔ should halt with the value it evaluates
      ✔ should evaluate an expression document
      ✔ should stop the steps after it from running
      ✔ should carry no Result at all when the expression produces nothing
      ✔ should return the state for $$ROOT
    Running Off the End
      ✔ should return the state, the way { $return: $$ROOT } would
      ✔ should finish a process which has no steps at all
      ✔ should empty the cursor when it is over
    Resuming
      ✔ should write the result into the state and carry on
      ✔ should finish the process it was resumed into
      ✔ should drop the Waiting descriptor
      ✔ should discard the result of a call which named no Into
      ✔ should remove the field when the result is nothing
      ✔ should write into a dotted path
      ✔ should refuse a run which is not waiting
      ✔ should fail the run when the host reports the call failed
      ✔ should take a code and a message from the host
      ✔ should not modify the run it was given
    Stepping and Executing
      ✔ should make stepping a halted run a no-op
      ✔ should return a new value rather than the run it was given
      ✔ should agree with repeated stepping
      ✔ should fail a run which does not halt within the budget
      ✔ should take a budget large enough to finish
      ✔ should step the same run twice to the same answer
      ✔ should keep two runs of one process apart
    Failure
      ✔ should never throw, whatever it is handed
      ✔ should always return a run
      ✔ should refuse a run which belongs to another process
      ✔ should refuse a run whose Status is not a status
      ✔ should report a step operator which is not registered
      ✔ should report a step which is not a document with one key
      ✔ should report a cursor which addresses nothing
      ✔ should name the cursor the failure happened at
      ✔ should keep the state a failed run had reached
    Storage
      ✔ should write a run down and read it back unchanged
      ✔ should step a stored run to the same place as the run it came from
      ✔ should keep $$NOW across storage, so a resumed run agrees with itself
      ✔ should carry a state holding the values plain JSON cannot
      ✔ should write a waiting run down with what it is waiting for
    Fanning Out Through the Host
      ✔ should resume the parent with the result of every child run
      ✔ should leave the parent state untouched while the children run
      ✔ should let the parent branch on what the children returned
      ✔ should write the parent down while its children are outstanding
      ✔ should offer a failed child to the parent $try


  132 passing (66ms)
```

## Process Invariants

```
Process Runtime Invariants

   32 fixtures

   1. storage is transparent               0
   2. stepping is deterministic            0
   3. Execute equals repeated Step         0
   4. runs are independent                 0
   5. Step is total                        0
   6. the input run is not modified        0
   7. a runaway loop is failed, not hung    0
   8. a failure is caught only where it should be    0

   Every invariant holds.
```

## Summary

- Unit Tests: 132 passed (passed)
- Process Invariants: passed
- Total: 132 passed
