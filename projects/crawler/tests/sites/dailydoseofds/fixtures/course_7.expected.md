# 📂 [Daily Dose of DS] Policy Gradients: REINFORCE and Actor-Critic

* **작성일:** Published on Jun 7, 2026
* **원본 링크:** [바로가기](https://www.dailydoseofds.com/rl-course-part-7/)

## 📝 본문 내용

## Reinforcement Learning Course

-   -   [Foundations of Reinforcement Learning](https://www.dailydoseofds.com/rl-course-part-1/)
    -   [Markov Decision Processes and Value Functions](https://www.dailydoseofds.com/rl-course-part-2/)
    -   [Bellman Equations and Dynamic Programming](https://www.dailydoseofds.com/rl-course-part-3/)
    -   [Model-Free Learning](https://www.dailydoseofds.com/rl-course-part-4/)
    -   [Function Approximation](https://www.dailydoseofds.com/rl-course-part-5/)
    -   [Introduction to Deep RL and DQN](https://www.dailydoseofds.com/rl-course-part-6/)
    -   [Policy Gradients: REINFORCE and Actor-Critic](https://www.dailydoseofds.com/rl-course-part-7/)

Reinforcement Learning Course

[](https://www.dailydoseofds.com/rl-course-part-7/# "Previous")[](https://www.dailydoseofds.com/rl-course-part-7/# "Next")

Reinforcement Learning Course

7/7[](https://www.dailydoseofds.com/rl-course-part-6/ "Previous")[](https://www.dailydoseofds.com/rl-course-part-7/# "Next")

20 min read

# Policy Gradients: REINFORCE and Actor-Critic

RL Part 7: Learning the policy directly, from REINFORCE to actor-critic.

👉

Hey! This is a member-only post. But it looks like you are from **United States of America 🇺🇸**. Join today by visiting this **[membership page](https://www.dailydoseofds.com/membership-7XQP25LK-HRVB64C2A/)** for relief pricing of **20%** off on your full access, FOREVER.

* * *

## Recap

In chapter 6, we moved from linear value function approximation to neural networks.

The value function generalized from a linear form to a neural network. What we gave up in that move was the convergence guarantee that held for linear on-policy methods.

![](https://substackcdn.com/image/fetch/$s_!6UHq!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F10dc0c81-9a85-4127-8cba-62679acde5fb_387x73.png)

We then saw what breaks when deep networks meet online Q-learning: correlated samples, moving targets, and the deadly triad scaled up. Two engineering fixes carried the day:

-   Experience replay stored past transitions and sampled them in random minibatches, breaking correlation.

![A diagram showing the replay buffer as a FIFO queue](https://substackcdn.com/image/fetch/$s_!03wX!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F532c998c-e75f-49c3-96a5-e5fb41ebf5b2_1376x768.png "A diagram showing the replay buffer as a FIFO queue")

-   Target networks froze a copy of the Q-network to compute stable bootstrap targets.

![](https://substackcdn.com/image/fetch/$s_!mhAf!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fed2ede7c-1b74-46cf-a4af-af9453e8d2ae_464x115.png)

Putting these together gave us DQN algorithm, which we trained from scratch on CartPole.

![](https://substackcdn.com/image/fetch/$s_!yVc7!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F63df8b1c-7c1c-4455-91a8-ca86893a4abe_1800x600.png)

If you have not read Chapter 6, we recommend doing so first:

[Introduction to Deep RL and DQN

RL Part 6: From linear features to neural networks, and the engineering choices that makes deep value-based RL possible.

![](https://storage.ghost.io/c/3f/df/3fdf6ed2-17ac-4b12-a693-8078bd13e748/content/images/icon/dailyds-logo-transparent-0e08f4b4-0b83-44d8-b366-22b6a35d68ac.png)Daily Dose of Data ScienceAvi Chawla

![](https://storage.ghost.io/c/3f/df/3fdf6ed2-17ac-4b12-a693-8078bd13e748/content/images/thumbnail/rl-cover-1-996e97d504e9f5b6d4180d6b8fc38ebf6cd85d325f885f59f07141ca4e59a2b1-e6c83329-8331-4c56-a8df-fbde0a577958.png)

](https://www.dailydoseofds.com/rl-course-part-6/)

Now most of the methods we learned so far share one trait. They learn how good actions are, then derive behavior by picking the best-scoring action. That works beautifully when actions are few and discrete. It strains badly when actions are continuous or numerous.

Hence, there is another way. Instead of scoring actions and choosing among them, we can learn the choosing itself. That is the subject of this chapter.

As for this part, we will focus on policy gradient methods. We will build the policy gradient from first principles, meet REINFORCE, confront its variance problem head-on, and learn about the actor-critic architecture.

Let's begin!

* * *

## Two ways to solve a control problem

A reinforcement learning agent needs a policy: a rule that says what to do in each state. Up to now, we built that rule indirectly. We learned a value function, an estimate of how much reward we can expect, and then acted greedily with respect to it. The policy was a byproduct of the values.

Policy gradient methods flip this around. They parameterize the policy directly and learn its parameters. We write the policy as a function with its own weights, and we adjust those weights to get better behavior.

![](https://substackcdn.com/image/fetch/$s_!gxvD!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fa6ad412f-5abc-4d97-8438-71832c7e500a_2000x987.png)

Let us make this concrete. A policy maps a state to a distribution over actions. We denote it as follows:

![](https://substackcdn.com/image/fetch/$s_!hC8i!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F7b17da78-79f8-496e-bb74-0d9fab59b405_156x65.png)

Here ππ is the policy, θθ are its learnable parameters (the weights of a neural network), ss is the current state, and aa is an action.

👉

The expression πθ(a∣s)πθ(a∣s) reads as the probability of taking action aa given that we are in state ss, under the policy defined by parameters θθ.

This is a stochastic policy and for continuous actions, the network typically outputs the mean and spread of a Gaussian distribution, and we sample from it.

👉

An important point or trade-off, however, is that policy gradient methods are on-policy and tend to be sample-hungry. Each update uses data from the current policy, and once we update, that data is stale.

To learn the policy directly, we need an objective: a single number measuring how good the policy is, which we can then push upward. The natural choice is the expected return:

![](https://substackcdn.com/image/fetch/$s_!fqOJ!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F86073c09-b1d2-4316-916b-afd98429dd00_316x74.png)

In this expression:

-   J(θ)J(θ) is the objective we want to maximize, written as a function of the policy parameters θθ.
-   The symbol ττ (tau) denotes a trajectory, the full sequence of states and actions in an episode.
-   The notation τ∼πθτ∼πθ means the trajectory is generated by following the current policy.
-   The term R(τ)R(τ) is the total return collected along that trajectory.
-   E\[⋅\]E\[⋅\] is the expectation, the average over all the trajectories the policy could produce.

👉

Reading the structure: we run the policy, collect trajectories, sum up the reward in each, and average. A larger J(θ)J(θ) means the policy collects more reward on average. Our entire goal reduces to one thing: adjust θθ to make J(θ)J(θ) as large as possible.

The intuition is direct. If we can compute the gradient of JJ with respect to θθ, we can climb it.

In summary, policy gradient methods learn a parameterized policy by maximizing expected return through gradient ascent. The challenge, which the next section solves, is computing that gradient at all.

* * *

## The log-derivative trick and the policy gradient theorem

We want the gradient of J(θ)J(θ), but there is an immediate obstacle. The objective is an expectation over trajectories, and the distribution of those trajectories itself depends on θθ.

Changing the parameters changes which trajectories we see. We cannot simply differentiate inside the average, because the thing we are averaging over is moving as we differentiate.

This is where one elegant identity rescues us. It is called the log-derivative trick, and it rests on a basic fact from calculus. The derivative of the natural logarithm of a function is the derivative of the function divided by the function itself:

![](https://substackcdn.com/image/fetch/$s_!YErO!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fc4000803-098a-48da-98b5-bb4b41f82e15_523x194.png)

Rearranging it gives the form we actually use: ∇θp(x)\=p(x)∇θlogp(x)∇θp(x)\=p(x)∇θlog⁡p(x).

Why does this matter? It converts a gradient of a probability into the probability times a gradient of a log-probability. The first form is hard to average over by sampling. The second form is exactly an expectation, which we can estimate by sampling. That single conversion is what makes the whole method work.
